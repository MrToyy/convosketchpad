import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { getCanvasIdentity } from '../lib/canvas-auth.js';
import {
  deleteCanvasArtifacts,
  readCanvasArtifact,
  readCanvasAttachment,
  validateCanvasAttachments,
} from '../lib/canvas-artifact-store.js';
import {
  getCanvasStore,
  type CanvasArtifact,
  type CanvasAttachment,
  type InteractionRecord,
  type CanvasStore,
} from '../lib/canvas-db.js';
import {
  CANVAS_RECONCILIATION_VERSION,
  scheduleCanvasInteractionReconciliation,
  signalCanvasInteractionTerminal,
} from '../lib/canvas-reconciler.js';
import { config } from '../lib/config.js';
import { gatewayRpcCall } from '../lib/gateway-rpc.js';
import {
  getCanvasSessionResetPolicy,
  sessionWillResetBeforeSend,
} from '../lib/openclaw-session-policy.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();
const SESSION_LIST_LIMIT = 1_000;

interface GatewayAgentSummary {
  id?: string;
}

interface GatewayAgentList {
  defaultId?: string;
  agents?: GatewayAgentSummary[];
}

interface GatewaySessionSummary {
  key?: string;
  sessionKey?: string;
  id?: string;
  sessionId?: string;
}

async function refreshBranchSessionIdentity(
  store: CanvasStore,
  target: { branchId: string; sessionKey: string },
  markMissing: boolean,
): Promise<void> {
  const response = await gatewayRpcCall('sessions.list', {
    limit: SESSION_LIST_LIMIT,
  }, 15_000) as { sessions?: GatewaySessionSummary[] };
  if (!Array.isArray(response.sessions)) return;

  const session = response.sessions.find(
    (candidate) => (candidate.sessionKey || candidate.key) === target.sessionKey,
  );
  const sessionId = session?.sessionId || session?.id;
  if (sessionId) store.observeBranchSession(target.branchId, sessionId);
  else if (!session && markMissing) store.markBranchSessionMissing(target.branchId);
}

async function listGatewayAgents(): Promise<{ defaultId: string; ids: Set<string> }> {
  let response: GatewayAgentList;
  try {
    response = await gatewayRpcCall('agents.list', {}, 15_000) as GatewayAgentList;
  } catch (error) {
    console.warn('[canvas] agents.list failed:', error instanceof Error ? error.message : error);
    throw new Error('agent_catalog_unavailable');
  }
  const agents = Array.isArray(response.agents) ? response.agents : [];
  const ids = new Set(agents.flatMap((agent) => typeof agent.id === 'string' && agent.id.trim() ? [agent.id.trim()] : []));
  const defaultId = typeof response.defaultId === 'string' ? response.defaultId.trim() : '';
  if (!defaultId || !ids.has(defaultId)) throw new Error('agent_catalog_unavailable');
  return { defaultId, ids };
}

const attachmentSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{40}$/),
  name: z.string().trim().min(1).max(512),
  mimeType: z.string().max(255).default('application/octet-stream'),
  sizeBytes: z.number().int().nonnegative(),
  uri: z.string().max(4096),
  storage: z.literal('canvas'),
  available: z.literal(true),
});

const artifactSchema = z.object({
  id: z.string().max(200).optional(),
  gatewayArtifactId: z.string().max(200).optional(),
  name: z.string().trim().min(1).max(512),
  mimeType: z.string().max(255).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  uri: z.string().min(1).max(8192),
  storage: z.enum(['canvas', 'external', 'source']).optional(),
  available: z.boolean().optional(),
  warning: z.string().max(2000).optional(),
});

function errorResponse(c: Context, error: unknown) {
  const message = error instanceof Error ? error.message : 'canvas_error';
  if (message === 'not_found') return c.json({ error: 'Not found' }, 404);
  if (message === 'agent_locked' || message === 'agent_changed') return c.json({ error: message }, 409);
  if (message === 'agent_catalog_unavailable') return c.json({ error: message }, 502);
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

function publicAttachment(attachment: CanvasAttachment): CanvasAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    uri: attachment.storage === 'canvas' && attachment.uri?.startsWith('/api/canvas/')
      ? attachment.uri
      : undefined,
    storage: attachment.storage,
    available: attachment.available,
    warning: attachment.warning,
  };
}

function publicArtifact(artifact: CanvasArtifact): CanvasArtifact {
  return {
    id: artifact.id,
    gatewayArtifactId: artifact.gatewayArtifactId,
    name: artifact.name,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    uri: artifact.storage === 'canvas' || artifact.storage === 'external' ? artifact.uri : '',
    storage: artifact.storage,
    available: artifact.available,
    warning: artifact.warning,
  };
}

function publicInteraction(interaction: InteractionRecord): InteractionRecord {
  return {
    ...interaction,
    attachments: interaction.attachments.map(publicAttachment),
    artifacts: interaction.artifacts.map(publicArtifact),
  };
}

app.get('/api/canvas/canvases', rateLimitGeneral, (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  return c.json({ canvases: getCanvasStore().listCanvases(identity.userId) });
});

app.post('/api/canvas/canvases', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({ name: z.string().trim().min(1).max(120) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid canvas' }, 400);
  try {
    const { defaultId } = await listGatewayAgents();
    return c.json({ canvas: getCanvasStore().createCanvas(identity.userId, parsed.data.name, defaultId) }, 201);
  } catch (error) { return errorResponse(c, error); }
});

app.patch('/api/canvas/canvases/:id', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    agentId: z.string().trim().min(1).max(120).optional(),
  }).refine((value) => value.name !== undefined || value.agentId !== undefined)
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid canvas update' }, 400);
  try {
    const store = getCanvasStore();
    const id = routeParam(c, 'id');
    let canvas = store.getCanvas(identity.userId, id);
    if (!canvas) return c.json({ error: 'Not found' }, 404);
    if (parsed.data.agentId && parsed.data.agentId !== canvas.agentId) {
      const { ids } = await listGatewayAgents();
      if (!ids.has(parsed.data.agentId)) throw new Error('unknown_agent');
      canvas = store.updateCanvasAgentBeforeFirstInteraction(identity.userId, id, parsed.data.agentId);
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
  for (const interaction of graph?.interactions || []) {
    const reconciliation = interaction.sessionMetadata.reconciliation as Record<string, unknown> | undefined;
    if (interaction.status === 'streaming'
      || reconciliation?.artifactSync === 'pending'
      || reconciliation?.artifactSync === 'degraded'
      || (interaction.status === 'completed' && !interaction.agentOutput.trim() && interaction.artifacts.length === 0)
      || reconciliation?.version !== CANVAS_RECONCILIATION_VERSION) {
      scheduleCanvasInteractionReconciliation(interaction.id, 0);
    }
  }
  return graph
    ? c.json({
      ...graph,
      interactions: graph.interactions.map(publicInteraction),
      reconciliationVersion: CANVAS_RECONCILIATION_VERSION,
    })
    : c.json({ error: 'Not found' }, 404);
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

app.get('/api/canvas/send-reservations/:id/resources/:resourceId', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const owned = getCanvasStore().getOwnedReservationResource(identity.userId, routeParam(c, 'id'), routeParam(c, 'resourceId'));
  if (!owned) return c.json({ error: 'Not found' }, 404);
  const { resource } = owned;

  try {
    let data: Uint8Array | null = null;
    if (resource.uri.startsWith('/api/canvas/artifacts/')) {
      const match = resource.uri.match(/^\/api\/canvas\/artifacts\/([^/]+)\/([^/]+)\/([^/]+)$/);
      const interaction = match ? getCanvasStore().getOwnedInteraction(identity.userId, decodeURIComponent(match[2])) : null;
      if (!match || !interaction || interaction.canvasId !== decodeURIComponent(match[1]) || interaction.id !== resource.sourceInteractionId) {
        return c.json({ error: 'Resource unavailable' }, 404);
      }
      const persisted = await readCanvasArtifact(interaction, decodeURIComponent(match[3]));
      data = persisted?.bytes || null;
    } else if (resource.uri.startsWith('/api/canvas/attachments/')) {
      const match = resource.uri.match(/^\/api\/canvas\/attachments\/([^/]+)\/([^/]+)$/);
      const canvasId = match ? decodeURIComponent(match[1]) : '';
      const attachmentId = match ? decodeURIComponent(match[2]) : '';
      const interaction = match ? getCanvasStore().getOwnedInteraction(identity.userId, resource.sourceInteractionId) : null;
      const attachment = interaction?.attachments.find((candidate) => candidate.id === attachmentId && candidate.storage === 'canvas');
      if (!interaction || interaction.canvasId !== canvasId || !attachment) return c.json({ error: 'Resource unavailable' }, 404);
      data = await readCanvasAttachment(identity.userId, canvasId, attachmentId);
    } else if (resource.uri.startsWith('data:')) {
      const match = resource.uri.match(/^data:[^;,]+;base64,(.+)$/s);
      if (match) data = Buffer.from(match[1], 'base64');
    }
    if (!data) return c.json({ error: 'Resource unavailable' }, 404);
    return new Response(data, {
      headers: {
        'Content-Type': resource.mimeType || 'application/octet-stream',
        'Content-Length': String(data.byteLength),
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.warn('[canvas] Bootstrap resource unavailable:', error instanceof Error ? error.message : error);
    return c.json({ error: 'Resource unavailable' }, 502);
  }
});

app.put('/api/canvas/canvases/:id/layout', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({
    nodes: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
    viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }).optional(),
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
    return c.json({ branch: getCanvasStore().createRootBranch(identity.userId, routeParam(c, 'id')) }, 201);
  } catch (error) { return errorResponse(c, error); }
});

app.post('/api/canvas/interactions/:id/fork', rateLimitGeneral, (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  try {
    return c.json({ branch: getCanvasStore().forkInteraction(identity.userId, routeParam(c, 'id')) }, 201);
  } catch (error) { return errorResponse(c, error); }
});

app.post('/api/canvas/branches/:id/prepare-send', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({
    expectedHeadInteractionId: z.string().uuid().nullable().optional(),
    expectedAgentId: z.string().trim().min(1).max(120),
    userInput: z.string().max(500_000).default(''),
    attachments: z.array(attachmentSchema).max(4).default([]),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid send request', details: parsed.error.flatten() }, 400);
  if (!parsed.data.userInput.trim() && parsed.data.attachments.length === 0) return c.json({ error: 'Message or attachment required' }, 400);
  try {
    const store = getCanvasStore();
    const branchId = routeParam(c, 'id');
    const branch = store.getOwnedBranch(identity.userId, branchId);
    if (!branch) return c.json({ error: 'Not found' }, 404);
    const canvas = store.getCanvas(identity.userId, branch.canvasId);
    if (!canvas) return c.json({ error: 'Not found' }, 404);
    if (canvas.agentId !== parsed.data.expectedAgentId) throw new Error('agent_changed');

    if (branch.sessionState === 'active') {
      try {
        await refreshBranchSessionIdentity(store, {
          branchId: branch.id,
          sessionKey: branch.sessionKey,
        }, true);
      } catch (error) {
        console.warn('[canvas] Session identity preflight skipped:', error instanceof Error ? error.message : error);
      }
    }

    let attachments: CanvasAttachment[];
    try {
      attachments = await validateCanvasAttachments(
        identity.userId,
        branch.canvasId,
        parsed.data.attachments as CanvasAttachment[],
      );
    } catch (error) {
      return c.json({
        error: 'Attachment persistence failed',
        detail: error instanceof Error ? error.message : 'Attachment could not be persisted',
      }, 422);
    }

    let forceSessionRecovery = false;
    if (branch.sessionState === 'active') {
      const refreshedBranch = store.getOwnedBranch(identity.userId, branch.id);
      if (refreshedBranch?.sessionIntegrity !== 'drifted') {
        const lifecycle = store.getOwnedBranchSessionLifecycle(identity.userId, branch.id);
        const resetPolicy = await getCanvasSessionResetPolicy();
        forceSessionRecovery =
          !resetPolicy.available ||
          !resetPolicy.policy ||
          !lifecycle ||
          sessionWillResetBeforeSend({
            policy: resetPolicy.policy,
            sessionStartedAt: lifecycle.sessionStartedAt,
            lastInteractionAt: lifecycle.lastInteractionAt,
            timeZone: config.gatewayTimezone,
          });
      }
    }

    const reservation = store.prepareSend(identity.userId, {
      branchId,
      expectedHeadInteractionId: parsed.data.expectedHeadInteractionId,
      userInput: parsed.data.userInput,
      attachments,
      forceSessionRecovery,
    });
    return c.json({ reservation });
  } catch (error) { return errorResponse(c, error); }
});

app.post('/api/canvas/send-reservations/:id/ack', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({
    runId: z.string().nullable().optional(),
    bootstrapWarnings: z.array(z.string().max(1000)).max(100).default([]),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid acknowledgement' }, 400);
  try {
    const store = getCanvasStore();
    const reservationId = routeParam(c, 'id');
    const target = store.getOwnedReservationSessionTarget(identity.userId, reservationId);
    if (target) {
      try {
        await refreshBranchSessionIdentity(store, target, false);
      } catch (error) {
        console.warn(
          '[canvas] Session identity acknowledgement refresh skipped:',
          error instanceof Error ? error.message : error,
        );
      }
    }
    const interaction = store.acknowledgeSend(
      identity.userId,
      reservationId,
      parsed.data.runId || null,
      parsed.data.bootstrapWarnings,
    );
    scheduleCanvasInteractionReconciliation(interaction.id);
    return c.json({ interaction: publicInteraction(interaction) });
  } catch (error) { return errorResponse(c, error); }
});

app.post('/api/canvas/send-reservations/:id/fail', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({ error: z.string().max(2000).default('Gateway rejected the message') }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid failure' }, 400);
  return getCanvasStore().failReservation(identity.userId, routeParam(c, 'id'), parsed.data.error)
    ? c.json({ ok: true })
    : c.json({ error: 'Not found' }, 404);
});

app.post('/api/canvas/interactions/:id/complete', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({
    status: z.enum(['completed', 'failed']),
    agentOutput: z.string().max(2_000_000).default(''),
    artifacts: z.array(artifactSchema).max(100).default([]),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid completion' }, 400);
  const interaction = getCanvasStore().completeInteraction(identity.userId, routeParam(c, 'id'), {
    ...parsed.data,
    artifacts: parsed.data.artifacts as CanvasArtifact[],
  });
  return interaction ? c.json({ interaction: publicInteraction(interaction) }) : c.json({ error: 'Not found' }, 404);
});

app.post('/api/canvas/interactions/:id/reconcile', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({
    terminalHint: z.boolean().default(false),
    failureHint: z.string().max(2_000).optional(),
    runId: z.string().max(500).optional(),
    force: z.boolean().default(false),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid reconciliation request' }, 400);

  const interaction = parsed.data.terminalHint || parsed.data.failureHint
    ? signalCanvasInteractionTerminal(routeParam(c, 'id'), identity.userId, {
      runId: parsed.data.runId,
      failureHint: parsed.data.failureHint,
    })
    : getCanvasStore().getOwnedInteraction(identity.userId, routeParam(c, 'id'));
  if (!interaction) return c.json({ error: 'Not found' }, 404);
  if (parsed.data.force) {
    getCanvasStore().updateReconciliationMetadata(interaction.id, {
      version: CANVAS_RECONCILIATION_VERSION,
      phase: 'pending',
      artifactSync: 'pending',
      forceRequestedAt: Date.now(),
    });
  }
  if ((!parsed.data.terminalHint && !parsed.data.failureHint) || parsed.data.force) {
    scheduleCanvasInteractionReconciliation(interaction.id, 0);
  }
  return c.json({ interaction: publicInteraction(interaction) });
});

export default app;
