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

  const db = await import('../lib/canvas-db.js');
  const artifacts = await import('../lib/canvas-artifact-store.js');
  const route = await import('./canvas.js');
  const app = new Hono();
  app.route('/', route.default);
  return { app, db, artifacts };
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
    reconciliation: { version: 3, phase: 'synced', artifactSync: 'synced' },
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
  it('serves an owner-scoped persisted Artifact with immutable headers', async () => {
    const current = await setup();
    const seeded = await seedPersistedArtifact(current);
    const response = await current.app.request(seeded.artifact.uri);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('persisted');
    expect(response.headers.get('Content-Type')).toBe('text/plain');
    expect(response.headers.get('Cache-Control')).toContain('immutable');
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
