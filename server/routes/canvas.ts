import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { getCanvasIdentity } from '../lib/canvas-auth.js';
import {
  deleteCanvasArtifacts,
  readCanvasArtifact,
  readCanvasAttachment,
} from '../lib/canvas-artifact-store.js';
import {
  ensureCanvasMediaDerivative,
  isCanvasMediaSystemError,
} from '../lib/canvas-media-derivatives.js';
import type { CanvasStore } from '../lib/canvas/persistence/canvas-store.js';
import {
  CanvasSendService,
} from '../lib/canvas/application/send-service.js';
import { CanvasBranchService } from '../lib/canvas/application/branch-service.js';
import { CanvasApprovalService } from '../lib/canvas/application/approval-service.js';
import { CanvasApplicationService } from '../lib/canvas/application/canvas-service.js';
import { CanvasApplicationError } from '../lib/canvas/application/errors.js';
import { CanvasResourceService } from '../lib/canvas/application/resource-service.js';
import { CanvasMergeSourceService } from '../lib/canvas/application/merge-source-service.js';
import { canvasInputDocumentHasContent } from '../lib/canvas/domain/input-document.js';
import {
  interactionHasPendingUpdates,
} from '../lib/canvas-reconciler.js';
import { dispatchCanvasSend } from '../lib/canvas-send-coordinator.js';
import { subscribeCanvasSync } from '../lib/canvas-sync.js';
import type { AgentRuntimeRegistry } from '../lib/agent-runtimes/registry.js';
import {
  publicCanvasInteraction as publicInteraction,
  publicCanvasAttachment,
  publicCanvasSummary,
  publicCanvasResourceThumbnailUri,
  publicCanvasSendReservation as publicSendReservation,
} from '../lib/canvas-public-dto.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { publishCanvasChanged } from '../lib/canvas-sync.js';

const encoder = new TextEncoder();
const canvasLayoutNodeSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(320).max(800).optional(),
  height: z.number().finite().min(240).max(900).optional(),
}).superRefine((node, context) => {
  if ((node.width === undefined) === (node.height === undefined)) return;
  context.addIssue({
    code: 'custom',
    message: 'width and height must be provided together',
  });
});

function sseFrame(event: string, data: unknown, id?: number): Uint8Array {
  return encoder.encode(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const agentRefSchema = z.object({
  runtimeId: z.string().trim().min(1).max(120),
  profileId: z.string().trim().min(1).max(120),
});

const canvasInputReferenceSchema = z.discriminatedUnion('origin', [
  z.object({
    key: z.string().min(1).max(120),
    origin: z.literal('current_turn_attachment'),
    attachmentId: z.string().regex(/^[a-f0-9]{40}$/),
  }),
  z.object({
    key: z.string().min(1).max(120),
    origin: z.literal('upstream'),
    kind: z.enum(['canvas_attachment', 'interaction_artifact']),
    sourceInteractionId: z.string().uuid(),
    resourceId: z.string().min(1).max(200),
  }),
]);

const canvasInputDocumentSchema = z.object({
  version: z.literal(1),
  segments: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string().max(500_000) }),
    z.object({ type: z.literal('resource'), key: z.string().min(1).max(120) }),
  ])).max(2_000),
  references: z.array(canvasInputReferenceSchema).max(9),
});

function errorResponse(c: Context, error: unknown) {
  if (error instanceof CanvasApplicationError) {
    switch (error.status) {
      case 400: return c.json({ error: error.publicMessage }, 400);
      case 404: return c.json({ error: error.publicMessage }, 404);
      case 409: return c.json({ error: error.publicMessage }, 409);
      case 410: return c.json({ error: error.publicMessage }, 410);
      case 422: return c.json({ error: error.publicMessage }, 422);
      case 502: return c.json({ error: error.publicMessage }, 502);
      case 503: return c.json({ error: error.publicMessage }, 503);
    }
  }
  const message = error instanceof Error ? error.message : 'canvas_error';
  if (message === 'not_found') return c.json({ error: 'Not found' }, 404);
  if (message === 'agent_locked' || message === 'agent_changed') return c.json({ error: message }, 409);
  if (message === 'agent_catalog_unavailable') return c.json({ error: message }, 503);
  if (message === 'unknown_agent') return c.json({ error: message }, 400);
  if (['invalid_branch_transition', 'send_in_progress', 'cannot_fork_branch_head', 'interaction_not_completed', 'redundant_merge_source', 'reservation_not_prepared'].includes(message)) {
    return c.json({ error: message }, 409);
  }
  if (message.includes('UNIQUE constraint failed')) return c.json({ error: 'conflict' }, 409);
  console.error('[canvas]', error);
  return c.json({ error: 'Canvas operation failed' }, 500);
}

function identityOr401(c: Context) {
  const identity = getCanvasIdentity(c);
  if (!identity) return null;
  return identity;
}

function routeParam(c: Context, name: string): string {
  return c.req.param(name) || '';
}

export interface CanvasRouteDependencies {
  store: CanvasStore;
  runtimes: AgentRuntimeRegistry;
  dispatchSend?: typeof dispatchCanvasSend;
  shutdownSignal?: AbortSignal;
}

export function createCanvasRoutes(dependencies: CanvasRouteDependencies) {
  const app = new Hono();
  const { store, runtimes } = dependencies;
  const dispatchSend = dependencies.dispatchSend || dispatchCanvasSend;
  const canvasApplicationService = () =>
    new CanvasApplicationService(store, runtimes, deleteCanvasArtifacts);

app.get('/api/canvas/canvases', rateLimitGeneral, (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  return c.json({ canvases: store.listCanvases(identity.userId).map(publicCanvasSummary) });
});

app.get('/api/canvas/agents', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  try {
    const catalog = await canvasApplicationService().agents(identity.userId);
    return c.json({
      firstAvailable: catalog.firstAvailable,
      agents: catalog.agents.map((profile) => ({
        agentRef: { runtimeId: profile.runtimeId, profileId: profile.profileId },
        displayName: profile.displayName,
        runtimeDisplayName: profile.runtimeDisplayName,
        available: profile.available,
        ...(profile.unavailableReason ? { unavailableReason: profile.unavailableReason } : {}),
      })),
    });
  } catch (error) {
    console.warn('[canvas] Agent profile catalog failed:', error instanceof Error ? error.message : error);
    return c.json({ error: 'agent_catalog_unavailable' }, 502);
  }
});

app.post('/api/canvas/canvases', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({ name: z.string().trim().min(1).max(120) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid canvas' }, 400);
  try {
    return c.json({ canvas: publicCanvasSummary(await canvasApplicationService().create(identity.userId, parsed.data.name)) }, 201);
  } catch (error) { return errorResponse(c, error); }
});

app.patch('/api/canvas/canvases/:id', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({
    name: z.string().trim().min(1).max(120).optional(),
  }).refine((value) => value.name !== undefined)
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid canvas update' }, 400);
  try {
    const id = routeParam(c, 'id');
    const canvas = await canvasApplicationService().update(identity.userId, id, parsed.data);
    return c.json({ canvas: publicCanvasSummary(canvas) });
  } catch (error) { return errorResponse(c, error); }
});

app.delete('/api/canvas/canvases/:id', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  try {
    const artifactCleanup = await canvasApplicationService().remove(identity.userId, routeParam(c, 'id'));
    return c.json({ ok: true, artifactCleanup });
  } catch (error) { return errorResponse(c, error); }
});

app.get('/api/canvas/canvases/:id/graph', rateLimitGeneral, (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const graph = store.getGraph(identity.userId, routeParam(c, 'id'));
  return graph
    ? c.json({
      ...graph,
      canvas: publicCanvasSummary(graph.canvas),
      interactions: graph.interactions.map(publicInteraction),
      pendingSends: graph.pendingSends.map(publicSendReservation),
      failedSends: graph.failedSends.map(publicSendReservation),
      hasPendingUpdates:
        graph.pendingSends.length > 0
        || graph.interactions.some(interactionHasPendingUpdates),
    })
    : c.json({ error: 'Not found' }, 404);
});

app.get('/api/canvas/canvases/:id/events', (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const canvasId = routeParam(c, 'id');
  if (!store.getCanvas(identity.userId, canvasId)) return c.json({ error: 'Not found' }, 404);
  const requested = Number(c.req.header('Last-Event-ID') || c.req.query('after') || 0);
  let cursor = Number.isSafeInteger(requested) && requested >= 0 ? requested : 0;
  let unsubscribe: () => void = () => undefined;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let catchup: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let shutdownListener: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        if (catchup) clearInterval(catchup);
        if (shutdownListener) {
          dependencies.shutdownSignal?.removeEventListener('abort', shutdownListener);
          shutdownListener = null;
        }
        try { controller.close(); } catch { /* stream already closed */ }
      };
      const flush = () => {
        if (closed) return;
        const batch = store.getCanvasSyncBatch(identity.userId, canvasId, cursor);
        if (!batch || batch.cursor <= cursor) return;
        cursor = batch.cursor;
        try {
          controller.enqueue(sseFrame('canvas.sync', {
            ...batch,
            ...(batch.canvas ? { canvas: publicCanvasSummary(batch.canvas) } : {}),
            interactions: batch.interactions.map(publicInteraction),
            sendOperations: batch.sendOperations.map(publicSendReservation),
          }, cursor));
        } catch {
          close();
        }
      };
      shutdownListener = close;
      dependencies.shutdownSignal?.addEventListener('abort', shutdownListener, { once: true });
      if (dependencies.shutdownSignal?.aborted) {
        close();
        return;
      }
      flush();
      if (closed) return;
      unsubscribe = subscribeCanvasSync((signal) => {
        if (signal.ownerId !== identity.userId || signal.canvasId !== canvasId || closed) return;
        if (signal.kind === 'preview') {
          try {
            controller.enqueue(sseFrame('node.preview', {
              interactionId: signal.interactionId,
              text: signal.text,
            }));
          } catch {
            close();
          }
          return;
        }
        flush();
      });
      catchup = setInterval(flush, 2_000);
      heartbeat = setInterval(() => {
        if (!getCanvasIdentity(c)) {
          close();
          return;
        }
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')); } catch { close(); }
      }, 15_000);
    },
    cancel() {
      if (closed) return;
      closed = true;
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      if (catchup) clearInterval(catchup);
      if (shutdownListener) {
        dependencies.shutdownSignal?.removeEventListener('abort', shutdownListener);
        shutdownListener = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

app.get('/api/canvas/artifacts/:canvasId/:interactionId/:artifactId', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const interaction = store.getOwnedInteraction(identity.userId, routeParam(c, 'interactionId'));
  if (!interaction || interaction.canvasId !== routeParam(c, 'canvasId')) return c.json({ error: 'Not found' }, 404);
  const persisted = await readCanvasArtifact(interaction, routeParam(c, 'artifactId')).catch(() => null);
  if (!persisted) return c.json({ error: 'Not found' }, 404);
  const safeName = persisted.artifact.name.replace(/[^\x20-\x7E]+/g, '_').replace(/[\r\n"\\]/g, '_').trim() || 'artifact';
  const encodedName = encodeURIComponent(persisted.artifact.name).replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(persisted.bytes, {
    headers: {
      'Content-Type': persisted.artifact.mimeType || 'application/octet-stream',
      'Content-Length': String(persisted.bytes.byteLength),
      'Content-Disposition': `${['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
        persisted.artifact.mimeType?.toLowerCase() || '',
      ) ? 'inline' : 'attachment'}; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
});

app.get('/api/canvas/artifacts/:canvasId/:interactionId/:artifactId/thumbnail', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const canvasId = routeParam(c, 'canvasId');
  const interactionId = routeParam(c, 'interactionId');
  const artifactId = routeParam(c, 'artifactId');
  const interaction = store.getOwnedInteraction(identity.userId, interactionId);
  if (!interaction || interaction.canvasId !== canvasId) return c.json({ error: 'Not found' }, 404);
  const artifact = interaction.artifacts.find((item) =>
    item.id === artifactId
    && item.storage === 'canvas'
    && item.available !== false
    && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(item.mimeType?.toLowerCase() || ''));
  if (!artifact) return c.json({ error: 'Not found' }, 404);
  try {
    const prepared = await ensureCanvasMediaDerivative(store, {
      ownerId: identity.userId,
      canvasId,
      name: artifact.name,
      mimeType: artifact.mimeType || 'application/octet-stream',
      contentHash: artifact.contentHash,
      loadBytes: async () => (await readCanvasArtifact(interaction, artifactId))?.bytes || null,
      recordContentHash: (contentHash) => {
        store.setInteractionArtifactContentHash(identity.userId, interactionId, artifactId, contentHash);
      },
    }, 'thumbnail');
    return new Response(prepared.bytes, {
      headers: {
        'Content-Type': prepared.derivative.mimeType,
        'Content-Length': String(prepared.bytes.byteLength),
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    if (isCanvasMediaSystemError(error)) {
      console.error(JSON.stringify({
        level: 'error',
        subsystem: 'canvas_media',
        action: 'artifact_thumbnail_failed',
        canvasId,
        interactionId,
        artifactId,
        error: error instanceof Error ? error.message : String(error),
      }));
      return c.json({ error: 'Thumbnail generation failed' }, 500);
    }
    return c.json({ error: 'Thumbnail unavailable' }, 404);
  }
});

app.get('/api/canvas/attachments/:canvasId/:attachmentId', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const canvasId = routeParam(c, 'canvasId');
  const attachmentId = routeParam(c, 'attachmentId');
  const attachment = store.getOwnedCanvasAttachment(identity.userId, canvasId, attachmentId);
  if (!attachment) return c.json({ error: 'Not found' }, 404);
  const bytes = await readCanvasAttachment(identity.userId, canvasId, attachmentId);
  if (!bytes) return c.json({ error: 'Not found' }, 404);
  const safeName = attachment.name.replace(/[^\x20-\x7E]+/g, '_').replace(/[\r\n"\\]/g, '_').trim() || 'attachment';
  const encodedName = encodeURIComponent(attachment.name).replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(bytes, {
    headers: {
      'Content-Type': attachment.mimeType || 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `inline; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
});

app.get('/api/canvas/attachments/:canvasId/:attachmentId/thumbnail', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const canvasId = routeParam(c, 'canvasId');
  const attachmentId = routeParam(c, 'attachmentId');
  const attachment = store.getOwnedCanvasAttachment(identity.userId, canvasId, attachmentId);
  if (!attachment || !attachment.mimeType.startsWith('image/')) {
    return c.json({ error: 'Not found' }, 404);
  }
  try {
    const prepared = await ensureCanvasMediaDerivative(store, {
      ownerId: identity.userId,
      canvasId,
      name: attachment.name,
      mimeType: attachment.mimeType,
      contentHash: attachment.contentHash,
      loadBytes: () => readCanvasAttachment(identity.userId, canvasId, attachmentId),
      recordContentHash: (contentHash) => {
        store.setCanvasAttachmentContentHash(identity.userId, canvasId, attachmentId, contentHash);
      },
    }, 'thumbnail');
    return new Response(prepared.bytes, {
      headers: {
        'Content-Type': prepared.derivative.mimeType,
        'Content-Length': String(prepared.bytes.byteLength),
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    if (isCanvasMediaSystemError(error)) {
      console.error(JSON.stringify({
        level: 'error',
        subsystem: 'canvas_media',
        action: 'attachment_thumbnail_failed',
        canvasId,
        attachmentId,
        error: error instanceof Error ? error.message : String(error),
      }));
      return c.json({ error: 'Thumbnail generation failed' }, 500);
    }
    return c.json({ error: 'Thumbnail unavailable' }, 404);
  }
});

app.put('/api/canvas/canvases/:id/layout', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({
    nodes: z.record(z.string(), canvasLayoutNodeSchema),
    viewport: z.object({
      x: z.number().finite(),
      y: z.number().finite(),
      zoom: z.number().finite().positive(),
    }).optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid layout' }, 400);
  return store.saveLayout(identity.userId, routeParam(c, 'id'), parsed.data)
    ? c.json({ ok: true })
    : c.json({ error: 'Not found' }, 404);
});

app.post('/api/canvas/canvases/:id/root-branches', rateLimitGeneral, (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  try {
    const service = new CanvasBranchService(store);
    return c.json({ branch: service.createRoot(identity.userId, routeParam(c, 'id')) }, 201);
  } catch (error) { return errorResponse(c, error); }
});

app.post('/api/canvas/interactions/:id/fork', rateLimitGeneral, (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  try {
    const service = new CanvasBranchService(store);
    return c.json({ branch: service.fork(identity.userId, routeParam(c, 'id')) }, 201);
  } catch (error) { return errorResponse(c, error); }
});

app.put('/api/canvas/branches/:id/merge-sources/:sourceInteractionId', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const params = z.object({
    targetBranchId: z.string().uuid(),
    sourceInteractionId: z.string().uuid(),
  }).safeParse({
    targetBranchId: routeParam(c, 'id'),
    sourceInteractionId: routeParam(c, 'sourceInteractionId'),
  });
  const parsed = z.object({
    expectedHeadInteractionId: z.string().uuid().nullable(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!params.success || !parsed.success) {
    return c.json({ error: 'Invalid merge source request' }, 400);
  }
  try {
    const result = new CanvasMergeSourceService(store).connect({
      ownerId: identity.userId,
      targetBranchId: params.data.targetBranchId,
      expectedHeadInteractionId: parsed.data.expectedHeadInteractionId,
      sourceInteractionId: params.data.sourceInteractionId,
    });
    if (result.created) publishCanvasChanged(identity.userId, result.canvasId);
    return c.json(
      { mergeSource: result.mergeSource, created: result.created },
      result.created ? 201 : 200,
    );
  } catch (error) { return errorResponse(c, error); }
});

app.post('/api/canvas/approvals/:id/resolve', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({
    choiceId: z.string().trim().min(1).max(120),
    grantedPermissionIds: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    confirmed: z.literal(true).optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid approval resolution' }, 400);
  try {
    const result = await new CanvasApprovalService(
      store,
      (runtimeId) => runtimes.get(runtimeId),
    ).resolve(identity.userId, routeParam(c, 'id'), {
      resolution: parsed.data,
      confirmed: parsed.data.confirmed === true,
    });
    if (result.outcome === 'rejected') return c.json({ error: result.error, approval: result.approval }, 409);
    if (result.outcome === 'unknown') {
      return c.json({ error: result.error, approval: result.approval }, 202);
    }
    return c.json({ approval: result.approval }, 200);
  } catch (error) {
    return errorResponse(c, error);
  }
});

app.post('/api/canvas/interactions/:id/copy', rateLimitGeneral, (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  try {
    const result = new CanvasBranchService(store).copy(identity.userId, routeParam(c, 'id'));
    return c.json({
      branch: result.branch,
      initialDraft: {
        agentRef: result.source.agentRef,
        inputDocument: result.source.inputDocument,
        resourceReferences: result.source.resourceReferences,
        persistedAttachments: result.source.attachments.map(publicCanvasAttachment),
      },
    }, 201);
  } catch (error) { return errorResponse(c, error); }
});

app.get('/api/canvas/branches/:id/resources', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({
    q: z.string().max(200).default(''),
    kind: z.enum(['all', 'image', 'file']).default('all'),
    cursor: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    runtimeId: z.string().trim().min(1).max(120),
    profileId: z.string().trim().min(1).max(120),
  }).safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Invalid resource query' }, 400);
  try {
    const catalog = await canvasApplicationService().agents(identity.userId);
    const selectedAgent = catalog.agents.find((agent) => agent.available
      && agent.runtimeId === parsed.data.runtimeId
      && agent.profileId === parsed.data.profileId);
    if (!selectedAgent) return c.json({ error: 'unknown_agent' }, 400);
    const query = parsed.data.q.trim().toLocaleLowerCase();
    const resources = await new CanvasResourceService(
      store,
      (runtimeId) => runtimes.get(runtimeId),
    ).list(identity.userId, routeParam(c, 'id'), {
      runtimeId: parsed.data.runtimeId,
      profileId: parsed.data.profileId,
    });
    const filtered = resources.filter((item) => {
      if (query && !item.name.toLocaleLowerCase().includes(query)) return false;
      if (parsed.data.kind === 'image') return item.mimeType.startsWith('image/');
      if (parsed.data.kind === 'file') return !item.mimeType.startsWith('image/');
      return true;
    });
    const items = filtered.slice(parsed.data.cursor, parsed.data.cursor + parsed.data.limit)
      .map((item) => {
        const thumbnailUri = publicCanvasResourceThumbnailUri(item);
        return {
          reference: {
            origin: 'upstream' as const,
            kind: item.reference.kind,
            sourceInteractionId: item.reference.sourceInteractionId,
            resourceId: item.reference.resourceId,
          },
          name: item.name,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          uri: item.uri,
          ...(thumbnailUri ? { thumbnailUri } : {}),
          available: item.available,
          selectable: item.selectable,
          unavailableReason: item.unavailableReason,
          sourceInteraction: {
            id: item.reference.sourceInteractionId,
            createdAt: item.sourceCreatedAt,
          },
        };
      });
    const nextOffset = parsed.data.cursor + items.length;
    return c.json({
      items,
      ...(nextOffset < filtered.length ? { nextCursor: String(nextOffset) } : {}),
    });
  } catch (error) { return errorResponse(c, error); }
});

app.post('/api/canvas/branches/:id/send', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({
    expectedHeadInteractionId: z.string().uuid().nullable().optional(),
    agentRef: agentRefSchema,
    userInput: z.string().max(500_000).optional(),
    inputDocument: canvasInputDocumentSchema.optional(),
    attachmentIds: z.array(z.string().regex(/^[a-f0-9]{40}$/)).max(9).default([]),
  }).superRefine((value, context) => {
    if ((value.userInput === undefined) === (value.inputDocument === undefined)) {
      context.addIssue({ code: 'custom', message: 'Provide exactly one input representation' });
    }
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid send request', details: parsed.error.flatten() }, 400);
  const hasInput = parsed.data.inputDocument
    ? canvasInputDocumentHasContent(parsed.data.inputDocument)
    : Boolean(parsed.data.userInput?.trim());
  if (!hasInput && parsed.data.attachmentIds.length === 0) {
    return c.json({ error: 'Message or attachment required' }, 400);
  }
  try {
    const catalog = await canvasApplicationService().agents(identity.userId);
    const selectedAgent = catalog.agents.find((agent) => agent.available
      && agent.runtimeId === parsed.data.agentRef.runtimeId
      && agent.profileId === parsed.data.agentRef.profileId);
    if (!selectedAgent) return c.json({ error: 'unknown_agent' }, 400);
    const result = await new CanvasSendService({
      store,
      runtimeResolver: (runtimeId) => runtimes.get(runtimeId),
      dispatch: dispatchSend,
    }).submit(identity.userId, {
      branchId: routeParam(c, 'id'),
      expectedHeadInteractionId: parsed.data.expectedHeadInteractionId,
      agentRef: parsed.data.agentRef,
      ...(parsed.data.userInput === undefined ? {} : { userInput: parsed.data.userInput }),
      ...(parsed.data.inputDocument === undefined ? {} : { inputDocument: parsed.data.inputDocument }),
      attachmentIds: parsed.data.attachmentIds,
    });
    if (result.kind === 'interaction') {
      return c.json({ interaction: publicInteraction(result.interaction) }, 201);
    }
    if (result.kind === 'rejected') {
      const payload = {
        error: result.error,
        operation: publicSendReservation(result.operation),
      };
      return result.status === 503 ? c.json(payload, 503) : c.json(payload, 422);
    }
    return c.json({ operation: publicSendReservation(result.operation) }, 202);
  } catch (error) { return errorResponse(c, error); }
});

app.get('/api/canvas/send-operations/:id', rateLimitGeneral, (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const operation = store.getOwnedReservation(identity.userId, routeParam(c, 'id'));
  return operation
    ? c.json({ operation: publicSendReservation(operation) })
    : c.json({ error: 'Not found' }, 404);
});

app.post('/api/canvas/send-operations/:id/retry', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const operation = store.getOwnedReservation(identity.userId, routeParam(c, 'id'));
  if (!operation) return c.json({ error: 'Not found' }, 404);
  if (operation.status !== 'prepared') return c.json({ error: 'send_not_retryable' }, 409);
  store.scheduleReservationRetry(operation.id, operation.dispatchState === 'ambiguous' ? 'ambiguous' : 'reserved', operation.error || '', Date.now());
  const result = await dispatchSend(operation.id);
  return 'agentOutput' in result
    ? c.json({ interaction: publicInteraction(result) })
    : c.json({ operation: publicSendReservation(result) }, 202);
});

app.post('/api/canvas/send-operations/:id/cancel', rateLimitGeneral, (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const operation = store.getOwnedReservation(identity.userId, routeParam(c, 'id'));
  if (!operation) return c.json({ error: 'Not found' }, 404);
  if (!['reserved', 'awaiting_media'].includes(operation.dispatchState)) {
    return c.json({ error: 'send_outcome_may_be_unknown' }, 409);
  }
  return store.failReservation(identity.userId, operation.id, 'Cancelled by user')
    ? c.json({ ok: true })
    : c.json({ error: 'send_not_cancellable' }, 409);
});

  return app;
}
