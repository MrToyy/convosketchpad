/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';

let tempRoot = '';
let workspaceRoot = '';
let artifactsRoot = '';

async function setup() {
  vi.resetModules();
  vi.doMock('../lib/config.js', () => ({
    config: {
      auth: false,
      canvasDatabasePath: path.join(tempRoot, 'canvas.sqlite'),
      canvasArtifactsPath: artifactsRoot,
      gatewayUrl: 'ws://127.0.0.1:18789',
      gatewayToken: 'test-token',
      home: tempRoot,
      memoryPath: path.join(workspaceRoot, 'MEMORY.md'),
      memoryDir: path.join(workspaceRoot, 'memory'),
    },
    SESSION_COOKIE_NAME: 'nerve_session_test',
  }));
  vi.doMock('../lib/canvas-auth.js', () => ({ getCanvasIdentity: () => ({ userId: 'owner-a', name: 'Owner A' }) }));
  vi.doMock('../middleware/rate-limit.js', () => ({ rateLimitGeneral: async (_c: unknown, next: () => Promise<void>) => next() }));
  vi.doMock('../lib/agent-workspace.js', () => ({
    resolveAgentWorkspace: () => ({ agentId: 'main', workspaceRoot, memoryPath: path.join(workspaceRoot, 'MEMORY.md'), memoryDir: path.join(workspaceRoot, 'memory') }),
  }));
  vi.doMock('../lib/gateway-rpc.js', () => ({ gatewayRpcCall: vi.fn(async () => ({ sessions: [] })) }));

  const db = await import('../lib/canvas-db.js');
  const artifacts = await import('../lib/canvas-artifact-store.js');
  const reconciler = await import('../lib/canvas-reconciler.js');
  const route = await import('./canvas.js');
  const app = new Hono();
  app.route('/', route.default);
  return { app, db, artifacts, reconciler };
}

async function seedPersistedArtifact(setupResult: Awaited<ReturnType<typeof setup>>, ownerId = 'owner-a') {
  const store = setupResult.db.getCanvasStore();
  store.ensureUser(ownerId, ownerId);
  const canvas = store.createCanvas(ownerId, 'Artifacts', 'main');
  const branch = store.createRootBranch(ownerId, canvas.id);
  const reservation = store.prepareSend(ownerId, { branchId: branch.id, userInput: 'create', attachments: [] });
  const base = store.acknowledgeSend(ownerId, reservation.id, 'run-1');
  const owned = store.getOwnedInteraction(ownerId, base.id)!;
  const materialized = await setupResult.artifacts.materializeCanvasArtifacts(owned, [{
    name: 'result.txt', mimeType: 'text/plain', uri: 'data:text/plain;base64,cGVyc2lzdGVk',
  }]);
  store.applyReconciledInteraction(base.id, {
    status: 'completed',
    agentOutput: 'done',
    artifacts: materialized.artifacts,
    reconciliation: { version: 4, phase: 'synced', artifactSync: 'synced' },
  });
  return { canvas, interactionId: base.id, artifact: materialized.artifacts[0] };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-artifacts-route-'));
  workspaceRoot = path.join(tempRoot, 'workspace');
  artifactsRoot = path.join(tempRoot, 'artifacts');
  await fs.mkdir(workspaceRoot, { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('Canvas Artifact routes', () => {
  it('serves a persisted user attachment after the upload staging file disappears', async () => {
    const current = await setup();
    const store = current.db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Attachments', 'main');
    const branch = store.createRootBranch('owner-a', canvas.id);
    const source = path.join(workspaceRoot, '.nerve', 'canvas-uploads', canvas.id, 'source.png');
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, 'durable-upload');

    const prepared = await current.app.request(`/api/canvas/branches/${branch.id}/prepare-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedAgentId: 'main',
        userInput: 'inspect this',
        attachments: [{ name: 'source.png', mimeType: 'image/png', sizeBytes: 14, uri: source }],
      }),
    });
    expect(prepared.status).toBe(200);
    const payload = await prepared.json() as { reservation: { id: string; attachments: Array<{ id: string; uri: string; storage: string }> } };
    expect(payload.reservation.attachments[0]).toEqual(expect.objectContaining({
      storage: 'canvas',
      uri: expect.stringMatching(/^\/api\/canvas\/attachments\//),
    }));

    store.acknowledgeSend('owner-a', payload.reservation.id, 'run-attachment');
    await fs.rm(source);
    const response = await current.app.request(payload.reservation.attachments[0].uri);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('durable-upload');
    expect(response.headers.get('Cache-Control')).toContain('immutable');
  });

  it('serves an owner-scoped persisted Artifact with immutable headers', async () => {
    const current = await setup();
    const seeded = await seedPersistedArtifact(current);
    const response = await current.app.request(seeded.artifact.uri);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('persisted');
    expect(response.headers.get('Content-Type')).toBe('text/plain');
    expect(response.headers.get('Cache-Control')).toContain('immutable');
  });

  it('advertises the server reconciliation contract version with the graph', async () => {
    const current = await setup();
    const seeded = await seedPersistedArtifact(current);
    const response = await current.app.request(`/api/canvas/canvases/${seeded.canvas.id}/graph`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ reconciliationVersion: 4 }));
  });

  it('treats a frontend terminal event as a hint instead of completing an empty interaction', async () => {
    const current = await setup();
    const store = current.db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Terminal hint', 'main');
    const branch = store.createRootBranch('owner-a', canvas.id);
    const reservation = store.prepareSend('owner-a', { branchId: branch.id, userInput: 'edit image', attachments: [] });
    const interaction = store.acknowledgeSend('owner-a', reservation.id, 'run-terminal');

    const response = await current.app.request(`/api/canvas/interactions/${interaction.id}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terminalHint: true, runId: 'run-terminal' }),
    });

    expect(response.status).toBe(200);
    current.reconciler.stopCanvasReconciler();
    expect(store.getOwnedInteraction('owner-a', interaction.id)).toEqual(expect.objectContaining({
      status: 'streaming',
      agentOutput: '',
      artifacts: [],
      sessionMetadata: expect.objectContaining({
        reconciliation: expect.objectContaining({
          version: 4,
          phase: 'terminal_hint_received',
          artifactSync: 'pending',
          terminalHintRunId: 'run-terminal',
        }),
      }),
    }));
  });

  it('does not expose another owner\'s persisted Artifact', async () => {
    const current = await setup();
    const seeded = await seedPersistedArtifact(current, 'owner-b');
    const response = await current.app.request(seeded.artifact.uri);
    expect(response.status).toBe(404);
  });

  it('deletes persisted Artifacts together with the Canvas', async () => {
    const current = await setup();
    const seeded = await seedPersistedArtifact(current);
    const response = await current.app.request(`/api/canvas/canvases/${seeded.canvas.id}`, { method: 'DELETE' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, artifactCleanup: 'completed' });
    expect(current.db.getCanvasStore().getCanvas('owner-a', seeded.canvas.id)).toBeNull();
    expect(await fs.readdir(artifactsRoot, { recursive: true }).catch(() => [])).not.toContain(seeded.artifact.id);
  });
});
