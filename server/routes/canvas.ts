import { Hono, type Context } from 'hono';
import { z } from 'zod';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCanvasIdentity } from '../lib/canvas-auth.js';
import {
  deleteCanvasArtifacts,
  materializeCanvasAttachments,
  readCanvasArtifact,
  readCanvasAttachment,
} from '../lib/canvas-artifact-store.js';
import { resolveAgentWorkspace } from '../lib/agent-workspace.js';
import {
  getCanvasStore,
  type CanvasArtifact,
  type CanvasAttachment,
  type CanvasStore,
} from '../lib/canvas-db.js';
import {
  CANVAS_RECONCILIATION_VERSION,
  resolveOpenClawArtifactUrl,
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
  id: z.string().max(200).optional(),
  name: z.string().trim().min(1).max(512),
  mimeType: z.string().max(255).default('application/octet-stream'),
  sizeBytes: z.number().int().nonnegative(),
  mode: z.enum(['inline', 'file_reference']).optional(),
  uri: z.string().max(4096).optional(),
  workspacePath: z.string().max(4096).optional(),
});

const artifactSchema = z.object({
  id: z.string().max(200).optional(),
  name: z.string().trim().min(1).max(512),
  mimeType: z.string().max(255).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  uri: z.string().min(1).max(8192),
  sourceUri: z.string().max(8192).optional(),
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

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function readOwnedLocalResource(uri: string, agentId: string): Promise<Uint8Array | null> {
  let candidate: string | null = null;
  try {
    if (uri.startsWith('file://')) candidate = fileURLToPath(uri);
    else if (uri.startsWith('/api/files?')) candidate = new URL(uri, 'http://canvas.local').searchParams.get('path');
  } catch { return null; }
  if (!candidate) return null;

  const workspaceRoot = path.resolve(resolveAgentWorkspace(agentId).workspaceRoot);
  const allowedRoots = [workspaceRoot, path.resolve(os.tmpdir()), path.resolve(os.homedir(), '.openclaw')];
  const resolved = path.resolve(candidate);
  if (!allowedRoots.some((root) => isWithin(resolved, root))) return null;
  const realPath = await fs.realpath(resolved).catch(() => null);
  if (!realPath) return null;
  const realAllowedRoots = await Promise.all(
    allowedRoots.map(async (root) => fs.realpath(root).catch(() => root)),
  );
  if (!realAllowedRoots.some((root) => isWithin(realPath, root))) return null;
  const stat = await fs.stat(realPath).catch(() => null);
  if (!stat?.isFile()) return null;
  return fs.readFile(realPath);
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
    const id = c.req.param('id');
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
  const canvasId = c.req.param('id');
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
  const graph = getCanvasStore().getGraph(identity.userId, c.req.param('id'));
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
  return graph ? c.json({ ...graph, reconciliationVersion: CANVAS_RECONCILIATION_VERSION }) : c.json({ error: 'Not found' }, 404);
});

app.get('/api/canvas/openclaw-artifact', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const uri = c.req.query('uri') || '';
  const target = resolveOpenClawArtifactUrl(uri);
  if (!target) return c.json({ error: 'Invalid OpenClaw artifact URL' }, 400);

  const match = uri.match(/^\/api\/chat\/media\/outgoing\/([^/]+)\//);
  let sessionKey = '';
  try { sessionKey = match ? decodeURIComponent(match[1]) : ''; } catch { /* invalid encoding */ }
  if (!sessionKey || !getCanvasStore().ownsSessionKey(identity.userId, sessionKey)) {
    return c.json({ error: 'Not found' }, 404);
  }

  try {
    const response = await fetch(target, {
      headers: config.gatewayToken ? { Authorization: `Bearer ${config.gatewayToken}` } : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok || !response.body) return c.json({ error: 'OpenClaw artifact unavailable' }, response.status === 404 ? 404 : 502);
    const headers = new Headers();
    for (const name of ['content-type', 'content-length', 'content-disposition', 'etag', 'last-modified']) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set('Cache-Control', 'private, max-age=3600');
    return new Response(response.body, { status: 200, headers });
  } catch (error) {
    console.warn('[canvas] OpenClaw artifact proxy failed:', error instanceof Error ? error.message : error);
    return c.json({ error: 'OpenClaw artifact unavailable' }, 502);
  }
});

app.get('/api/canvas/artifacts/:canvasId/:interactionId/:artifactId', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const interaction = getCanvasStore().getOwnedInteraction(identity.userId, c.req.param('interactionId'));
  if (!interaction || interaction.canvasId !== c.req.param('canvasId')) return c.json({ error: 'Not found' }, 404);
  const persisted = await readCanvasArtifact(interaction, c.req.param('artifactId')).catch(() => null);
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
  const canvasId = c.req.param('canvasId');
  const attachmentId = c.req.param('attachmentId');
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
  const owned = getCanvasStore().getOwnedReservationResource(identity.userId, c.req.param('id'), c.req.param('resourceId'));
  if (!owned) return c.json({ error: 'Not found' }, 404);
  const { resource, agentId } = owned;

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
    } else if (resource.uri.startsWith('/api/chat/media/outgoing/')) {
      const target = resolveOpenClawArtifactUrl(resource.uri);
      if (!target) return c.json({ error: 'Resource unavailable' }, 404);
      const response = await fetch(target, {
        headers: config.gatewayToken ? { Authorization: `Bearer ${config.gatewayToken}` } : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return c.json({ error: 'Resource unavailable' }, response.status === 404 ? 404 : 502);
      data = new Uint8Array(await response.arrayBuffer());
    } else if (resource.uri.startsWith('data:')) {
      const match = resource.uri.match(/^data:[^;,]+;base64,(.+)$/s);
      if (match) data = Buffer.from(match[1], 'base64');
    } else {
      data = await readOwnedLocalResource(resource.uri, agentId);
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
  return getCanvasStore().saveLayout(identity.userId, c.req.param('id'), parsed.data)
    ? c.json({ ok: true })
    : c.json({ error: 'Not found' }, 404);
});

app.post('/api/canvas/canvases/:id/root-branches', rateLimitGeneral, (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  try {
    return c.json({ branch: getCanvasStore().createRootBranch(identity.userId, c.req.param('id')) }, 201);
  } catch (error) { return errorResponse(c, error); }
});

app.post('/api/canvas/interactions/:id/fork', rateLimitGeneral, (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  try {
    return c.json({ branch: getCanvasStore().forkInteraction(identity.userId, c.req.param('id')) }, 201);
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
    const branchId = c.req.param('id');
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
      attachments = await materializeCanvasAttachments(
        identity.userId,
        branch.canvasId,
        canvas.agentId,
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
    const reservationId = c.req.param('id');
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
    return c.json({ interaction });
  } catch (error) { return errorResponse(c, error); }
});

app.post('/api/canvas/send-reservations/:id/fail', rateLimitGeneral, async (c) => {
  const identity = identityOr401(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  const parsed = z.object({ error: z.string().max(2000).default('Gateway rejected the message') }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid failure' }, 400);
  return getCanvasStore().failReservation(identity.userId, c.req.param('id'), parsed.data.error)
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
  const interaction = getCanvasStore().completeInteraction(identity.userId, c.req.param('id'), {
    ...parsed.data,
    artifacts: parsed.data.artifacts as CanvasArtifact[],
  });
  return interaction ? c.json({ interaction }) : c.json({ error: 'Not found' }, 404);
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
    ? signalCanvasInteractionTerminal(c.req.param('id'), identity.userId, {
      runId: parsed.data.runId,
      failureHint: parsed.data.failureHint,
    })
    : getCanvasStore().getOwnedInteraction(identity.userId, c.req.param('id'));
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
  return c.json({ interaction });
});

export default app;
