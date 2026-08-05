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
import {
  getCanvasStore,
} from '../lib/canvas-db.js';
import {
  CanvasSendApplicationError,
  CanvasSendService,
} from '../lib/canvas-send-service.js';
import { CanvasBranchService } from '../lib/canvas-branch-service.js';
import {
  interactionHasPendingUpdates,
} from '../lib/canvas-reconciler.js';
import { dispatchCanvasSend } from '../lib/canvas-send-coordinator.js';
import { subscribeCanvasSync } from '../lib/canvas-sync.js';
import { agentRuntimeRegistry } from '../lib/agent-runtimes/registry.js';
import { listAgentCatalog } from '../lib/agent-runtimes/catalog.js';
import { RuntimeOperationError } from '../lib/agent-runtimes/contract.js';
import {
  publicCanvasInteraction as publicInteraction,
  publicCanvasSendReservation as publicSendReservation,
} from '../lib/canvas-public-dto.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();
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

async function availableAgentCatalog(ownerId: string) {
  try {
    return await listAgentCatalog(agentRuntimeRegistry, { ownerId });
  } catch (error) {
    console.warn('[canvas] Agent profile catalog failed:', error instanceof Error ? error.message : error);
    throw new Error('agent_catalog_unavailable', { cause: error });
  }
}

function errorResponse(c: Context, error: unknown) {
  if (error instanceof CanvasSendApplicationError) {
    if (error.status === 404) return c.json({ error: error.publicMessage }, 404);
    if (error.status === 409) return c.json({ error: error.publicMessage }, 409);
    return c.json({ error: error.publicMessage }, 422);
  }
  const message = error instanceof Error ? error.message : 'canvas_error';
  if (message === 'not_found') return c.json({ error: 'Not found' }, 404);
  if (message === 'agent_locked' || message === 'agent_changed') return c.json({ error: message }, 409);
  if (message === 'agent_catalog_unavailable') return c.json({ error: message }, 503);
  if (message === 'unknown_agent') return c.json({ error: message }, 400);
  if (['invalid_branch_transition', 'send_in_progress', 'cannot_fork_branch_head', 'interaction_not_completed', 'reservation_not_prepared'].includes(message)) {
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

app.get('/api/canvas/canvases', rateLimitGeneral, (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  return c.json({ canvases: getCanvasStore().listCanvases(identity.userId) });
});

app.get('/api/canvas/agents', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  try {
    const catalog = await availableAgentCatalog(identity.userId);
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
    const catalog = await availableAgentCatalog(identity.userId);
    if (!catalog.firstAvailable) throw new Error('agent_catalog_unavailable');
    return c.json({
      canvas: getCanvasStore().createCanvas(identity.userId, parsed.data.name, catalog.firstAvailable),
    }, 201);
  } catch (error) { return errorResponse(c, error); }
});

app.patch('/api/canvas/canvases/:id', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    agentRef: agentRefSchema.optional(),
  }).refine((value) => value.name !== undefined || value.agentRef !== undefined)
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid canvas update' }, 400);
  try {
    const store = getCanvasStore();
    const id = routeParam(c, 'id');
    let canvas = store.getCanvas(identity.userId, id);
    if (!canvas) return c.json({ error: 'Not found' }, 404);
    if (parsed.data.agentRef) {
      const catalog = await availableAgentCatalog(identity.userId);
      const selected = catalog.agents.find((agent) =>
        agent.available
        && agent.runtimeId === parsed.data.agentRef?.runtimeId
        && agent.profileId === parsed.data.agentRef?.profileId);
      if (!selected) throw new Error('unknown_agent');
      canvas = store.updateCanvasAgentBeforeFirstInteraction(identity.userId, id, parsed.data.agentRef);
    }
    if (parsed.data.name) canvas = store.updateCanvas(identity.userId, id, parsed.data.name);
    return canvas ? c.json({ canvas }) : c.json({ error: 'Not found' }, 404);
  } catch (error) { return errorResponse(c, error); }
});

app.delete('/api/canvas/canvases/:id', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const canvasId = routeParam(c, 'id');
  if (!getCanvasStore().getCanvas(identity.userId, canvasId)) return c.json({ error: 'Not found' }, 404);
  if (!getCanvasStore().deleteCanvas(identity.userId, canvasId)) return c.json({ error: 'Not found' }, 404);
  try {
    await deleteCanvasArtifacts(identity.userId, canvasId);
    return c.json({ ok: true, artifactCleanup: 'completed' });
  } catch (error) {
    console.warn('[canvas] Artifact cleanup deferred:', error instanceof Error ? error.message : error);
    return c.json({ ok: true, artifactCleanup: 'pending' });
  }
});

app.get('/api/canvas/canvases/:id/graph', rateLimitGeneral, (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const graph = getCanvasStore().getGraph(identity.userId, routeParam(c, 'id'));
  return graph
    ? c.json({
      ...graph,
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
  const store = getCanvasStore();
  if (!store.getCanvas(identity.userId, canvasId)) return c.json({ error: 'Not found' }, 404);
  const requested = Number(c.req.header('Last-Event-ID') || c.req.query('after') || 0);
  let cursor = Number.isSafeInteger(requested) && requested >= 0 ? requested : 0;
  let unsubscribe: () => void = () => undefined;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let catchup: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const flush = () => {
        if (closed) return;
        const batch = store.getCanvasSyncBatch(identity.userId, canvasId, cursor);
        if (!batch || batch.cursor <= cursor) return;
        cursor = batch.cursor;
        try {
          controller.enqueue(sseFrame('canvas.sync', {
            ...batch,
            interactions: batch.interactions.map(publicInteraction),
            sendOperations: batch.sendOperations.map(publicSendReservation),
          }, cursor));
        } catch {
          closed = true;
        }
      };
      flush();
      unsubscribe = subscribeCanvasSync((signal) => {
        if (signal.ownerId !== identity.userId || signal.canvasId !== canvasId || closed) return;
        if (signal.kind === 'preview') {
          try {
            controller.enqueue(sseFrame('node.preview', {
              interactionId: signal.interactionId,
              text: signal.text,
            }));
          } catch {
            closed = true;
          }
          return;
        }
        flush();
      });
      catchup = setInterval(flush, 2_000);
      heartbeat = setInterval(() => {
        if (!getCanvasIdentity(c)) {
          closed = true;
          unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
          if (catchup) clearInterval(catchup);
          controller.close();
          return;
        }
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')); } catch { closed = true; }
      }, 15_000);
    },
    cancel() {
      closed = true;
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      if (catchup) clearInterval(catchup);
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
  const interaction = getCanvasStore().getOwnedInteraction(identity.userId, routeParam(c, 'interactionId'));
  if (!interaction || interaction.canvasId !== routeParam(c, 'canvasId')) return c.json({ error: 'Not found' }, 404);
  const persisted = await readCanvasArtifact(interaction, routeParam(c, 'artifactId')).catch(() => null);
  if (!persisted) return c.json({ error: 'Not found' }, 404);
  const safeName = persisted.artifact.name.replace(/[^\x20-\x7E]+/g, '_').replace(/[\r\n"\\]/g, '_').trim() || 'artifact';
  const encodedName = encodeURIComponent(persisted.artifact.name).replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(persisted.bytes, {
    headers: {
      'Content-Type': persisted.artifact.mimeType || 'application/octet-stream',
      'Content-Length': String(persisted.bytes.byteLength),
      'Content-Disposition': `inline; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
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
  const store = getCanvasStore();
  const interaction = store.getOwnedInteraction(identity.userId, interactionId);
  if (!interaction || interaction.canvasId !== canvasId) return c.json({ error: 'Not found' }, 404);
  const artifact = interaction.artifacts.find((item) =>
    item.id === artifactId
    && item.storage === 'canvas'
    && item.available !== false
    && item.mimeType?.startsWith('image/'));
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
  const attachment = getCanvasStore().getOwnedCanvasAttachment(identity.userId, canvasId, attachmentId);
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
  const store = getCanvasStore();
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
  return getCanvasStore().saveLayout(identity.userId, routeParam(c, 'id'), parsed.data)
    ? c.json({ ok: true })
    : c.json({ error: 'Not found' }, 404);
});

app.post('/api/canvas/canvases/:id/root-branches', rateLimitGeneral, (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  try {
    const service = new CanvasBranchService(getCanvasStore());
    return c.json({ branch: service.createRoot(identity.userId, routeParam(c, 'id')) }, 201);
  } catch (error) { return errorResponse(c, error); }
});

app.post('/api/canvas/interactions/:id/fork', rateLimitGeneral, (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  try {
    const service = new CanvasBranchService(getCanvasStore());
    return c.json({ branch: service.fork(identity.userId, routeParam(c, 'id')) }, 201);
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
  const store = getCanvasStore();
  let claimed: ReturnType<typeof store.claimInteractionApproval> | null = null;
  try {
    claimed = store.claimInteractionApproval(
      identity.userId,
      routeParam(c, 'id'),
      parsed.data,
      parsed.data.confirmed === true,
    );
    const result = await agentRuntimeRegistry.get(claimed.runtimeId).resolveApproval({
      approvalRef: claimed.approvalRef,
      resolution: claimed.resolution || parsed.data,
    });
    const approval = store.finishInteractionApproval(
      claimed.id,
      result.outcome,
      result.outcome === 'accepted' ? undefined : result.error.message,
    );
    if (result.outcome === 'rejected') return c.json({ error: result.error.message, approval }, 409);
    return c.json({ approval }, result.outcome === 'unknown' ? 202 : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'approval_resolution_failed';
    if (message === 'not_found') return c.json({ error: 'Not found' }, 404);
    if (message === 'approval_expired') return c.json({ error: message }, 410);
    if (message.startsWith('approval_')) return c.json({ error: message }, 409);
    if (claimed) {
      const retryable = error instanceof RuntimeOperationError
        && ['validation', 'unsupported', 'unauthorized', 'rejected', 'conflict'].includes(error.kind);
      const approval = store.finishInteractionApproval(
        claimed.id,
        retryable ? 'rejected' : 'unknown',
        message,
      );
      return c.json(
        { error: retryable ? message : 'approval_resolution_unconfirmed', approval },
        retryable ? 409 : 202,
      );
    }
    console.error('[canvas approval]', error);
    return c.json({ error: 'approval_resolution_failed' }, 500);
  }
});

app.post('/api/canvas/interactions/:id/resubmit', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({
    expectedAgentRef: agentRefSchema,
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid resubmit request' }, 400);
  try {
    const result = await new CanvasSendService({ store: getCanvasStore() }).resubmit(
      identity.userId,
      {
        interactionId: routeParam(c, 'id'),
        expectedAgentRef: parsed.data.expectedAgentRef,
      },
    );
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

app.post('/api/canvas/branches/:id/send', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({
    expectedHeadInteractionId: z.string().uuid().nullable().optional(),
    expectedAgentRef: agentRefSchema,
    userInput: z.string().max(500_000).default(''),
    attachmentIds: z.array(z.string().regex(/^[a-f0-9]{40}$/)).max(4).default([]),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid send request', details: parsed.error.flatten() }, 400);
  if (!parsed.data.userInput.trim() && parsed.data.attachmentIds.length === 0) {
    return c.json({ error: 'Message or attachment required' }, 400);
  }
  try {
    const store = getCanvasStore();
    const result = await new CanvasSendService({ store }).submit(identity.userId, {
      branchId: routeParam(c, 'id'),
      expectedHeadInteractionId: parsed.data.expectedHeadInteractionId,
      expectedAgentRef: parsed.data.expectedAgentRef,
      userInput: parsed.data.userInput,
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
  const operation = getCanvasStore().getOwnedReservation(identity.userId, routeParam(c, 'id'));
  return operation
    ? c.json({ operation: publicSendReservation(operation) })
    : c.json({ error: 'Not found' }, 404);
});

app.post('/api/canvas/send-operations/:id/retry', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const operation = getCanvasStore().getOwnedReservation(identity.userId, routeParam(c, 'id'));
  if (!operation) return c.json({ error: 'Not found' }, 404);
  if (operation.status !== 'prepared') return c.json({ error: 'send_not_retryable' }, 409);
  getCanvasStore().scheduleReservationRetry(operation.id, operation.dispatchState === 'ambiguous' ? 'ambiguous' : 'reserved', operation.error || '', Date.now());
  const result = await dispatchCanvasSend(operation.id);
  return 'agentOutput' in result
    ? c.json({ interaction: publicInteraction(result) })
    : c.json({ operation: publicSendReservation(result) }, 202);
});

app.post('/api/canvas/send-operations/:id/dispatch', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const operation = getCanvasStore().getOwnedReservation(identity.userId, routeParam(c, 'id'));
  if (!operation) return c.json({ error: 'Not found' }, 404);
  if (operation.status !== 'prepared') return c.json({ error: 'send_not_dispatchable' }, 409);
  const result = await dispatchCanvasSend(operation.id);
  return 'agentOutput' in result
    ? c.json({ interaction: publicInteraction(result) })
    : c.json({ operation: publicSendReservation(result) }, 202);
});

app.post('/api/canvas/send-operations/:id/cancel', rateLimitGeneral, (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const operation = getCanvasStore().getOwnedReservation(identity.userId, routeParam(c, 'id'));
  if (!operation) return c.json({ error: 'Not found' }, 404);
  if (!['reserved', 'awaiting_media'].includes(operation.dispatchState)) {
    return c.json({ error: 'send_outcome_may_be_unknown' }, 409);
  }
  return getCanvasStore().failReservation(identity.userId, operation.id, 'Cancelled by user')
    ? c.json({ ok: true })
    : c.json({ error: 'send_not_cancellable' }, 409);
});

export default app;
