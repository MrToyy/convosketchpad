import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import sharp from 'sharp';

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
    SESSION_COOKIE_NAME: 'convosketchpad_session_test',
  }));
  vi.doMock('../lib/canvas-auth.js', () => ({ getCanvasIdentity: () => ({ userId: 'owner-a', name: 'Owner A' }) }));
  vi.doMock('../middleware/rate-limit.js', () => ({ rateLimitGeneral: async (_c: unknown, next: () => Promise<void>) => next() }));
  const db = await import('../lib/canvas/persistence/canvas-store.js');
  const { testConversationHandleFactory } = await import('../lib/fixtures/test-conversation-handle.js');
  db.getCanvasStore(testConversationHandleFactory);
  const artifacts = await import('../lib/canvas-artifact-store.js');
  const reconciler = await import('../lib/canvas-reconciler.js');
  const route = await import('./canvas.js');
  const app = new Hono();
  app.route('/', route.createCanvasRoutes({
    store: db.getCanvasStore(),
    runtimes: { get: vi.fn(), list: () => [] } as never,
  }));
  return { app, db, artifacts, reconciler };
}

async function seedPersistedArtifact(setupResult: Awaited<ReturnType<typeof setup>>, ownerId = 'owner-a') {
  const store = setupResult.db.getCanvasStore();
  store.ensureUser(ownerId, ownerId);
  const canvas = store.createCanvas(ownerId, 'Artifacts', { runtimeId: 'openclaw', profileId: 'main' });
  const branch = store.createRootBranch(ownerId, canvas.id);
  const reservation = store.prepareSend(ownerId, { branchId: branch.id, userInput: 'create', attachments: [] });
  const base = store.acknowledgeSend(ownerId, reservation.id, 'run-1');
  const owned = store.getOwnedInteraction(ownerId, base.id)!;
  const artifact = await setupResult.artifacts.persistCanvasArtifactBytes(
    owned,
    { name: 'result.txt', mimeType: 'text/plain', uri: 'data:text/plain;base64,cGVyc2lzdGVk' },
    'data:text/plain;base64,cGVyc2lzdGVk',
    Buffer.from('persisted'),
    'text/plain',
  );
  store.applyReconciledInteraction(base.id, {
    status: 'completed',
    agentOutput: 'done',
    artifacts: [artifact],
    reconciliation: { phase: 'synced', artifactSync: 'synced' },
  });
  return { canvas, interactionId: base.id, artifact };
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
  it('projects and serves a cached thumbnail for a Canvas image attachment', async () => {
    const current = await setup();
    const store = current.db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Image attachment', { runtimeId: 'openclaw', profileId: 'main' });
    const branch = store.createRootBranch('owner-a', canvas.id);
    const original = await sharp({
      create: {
        width: 1400,
        height: 900,
        channels: 3,
        background: { r: 80, g: 120, b: 200 },
      },
    }).png().toBuffer();
    const attachment = await current.artifacts.persistCanvasAttachment('owner-a', canvas.id, {
      name: 'source.png',
      mimeType: 'image/png',
      bytes: original,
    });
    store.recordCanvasAttachment('owner-a', canvas.id, attachment);
    const reservation = store.prepareSend('owner-a', {
      branchId: branch.id,
      userInput: 'inspect',
      attachments: [attachment],
    });
    store.acknowledgeSend('owner-a', reservation.id, 'run-image');

    const graphResponse = await current.app.request(`/api/canvas/canvases/${canvas.id}/graph`);
    const graph = await graphResponse.json() as {
      interactions: Array<{ attachments: Array<{ thumbnailUri?: string; contentHash?: string }> }>;
    };
    const projected = graph.interactions[0].attachments[0];
    expect(projected.thumbnailUri).toContain('/thumbnail?v=thumbnail-v1');
    expect(projected).not.toHaveProperty('contentHash');

    const first = await current.app.request(projected.thumbnailUri!);
    const firstBytes = Buffer.from(await first.arrayBuffer());
    const second = await current.app.request(projected.thumbnailUri!);
    expect(first.status).toBe(200);
    expect(first.headers.get('Content-Type')).toBe('image/webp');
    expect(first.headers.get('Cache-Control')).toContain('immutable');
    expect(Buffer.from(await second.arrayBuffer()).equals(firstBytes)).toBe(true);
    expect(Math.max(
      (await sharp(firstBytes).metadata()).width || 0,
      (await sharp(firstBytes).metadata()).height || 0,
    )).toBeLessThanOrEqual(768);

    const originalResponse = await current.app.request(attachment.uri!);
    expect(Buffer.from(await originalResponse.arrayBuffer()).equals(original)).toBe(true);
  });

  it('projects and serves a thumbnail for a Canvas-local Agent image Artifact', async () => {
    const current = await setup();
    const store = current.db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Image artifact', { runtimeId: 'openclaw', profileId: 'main' });
    const branch = store.createRootBranch('owner-a', canvas.id);
    const reservation = store.prepareSend('owner-a', {
      branchId: branch.id,
      userInput: 'create image',
      attachments: [],
    });
    const created = store.acknowledgeSend('owner-a', reservation.id, 'run-artifact-image');
    const owned = store.getOwnedInteraction('owner-a', created.id)!;
    const original = await sharp({
      create: {
        width: 1000,
        height: 700,
        channels: 4,
        background: { r: 180, g: 70, b: 40, alpha: 0.8 },
      },
    }).png().toBuffer();
    const artifact = await current.artifacts.persistCanvasArtifactBytes(
      owned,
      { name: 'result.png', mimeType: 'image/png', uri: '/result.png' },
      '/result.png',
      original,
      'image/png',
    );
    store.applyReconciledInteraction(created.id, {
      status: 'completed',
      agentOutput: 'done',
      artifacts: [artifact],
      reconciliation: { phase: 'synced', artifactSync: 'synced' },
    });

    const graphResponse = await current.app.request(`/api/canvas/canvases/${canvas.id}/graph`);
    const graph = await graphResponse.json() as {
      interactions: Array<{ artifacts: Array<{ thumbnailUri?: string; contentHash?: string }> }>;
    };
    const projected = graph.interactions[0].artifacts[0];
    expect(projected.thumbnailUri).toContain('/thumbnail?v=thumbnail-v1');
    expect(projected).not.toHaveProperty('contentHash');
    const thumbnail = await current.app.request(projected.thumbnailUri!);
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get('Content-Type')).toBe('image/webp');
  });

  it('serves a Canvas-owned user attachment without an OpenClaw staging file', async () => {
    const current = await setup();
    const store = current.db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Attachments', { runtimeId: 'openclaw', profileId: 'main' });
    const branch = store.createRootBranch('owner-a', canvas.id);
    const attachment = await current.artifacts.persistCanvasAttachment('owner-a', canvas.id, {
      name: 'source.png',
      mimeType: 'image/png',
      bytes: Buffer.from('durable-upload'),
    });
    store.recordCanvasAttachment('owner-a', canvas.id, attachment);
    const reservation = store.prepareSend('owner-a', {
      branchId: branch.id,
      userInput: 'inspect this',
      attachments: [attachment],
    });
    expect(reservation.attachments[0]).toEqual(expect.objectContaining({
      storage: 'canvas',
      uri: expect.stringMatching(/^\/api\/canvas\/attachments\//),
    }));

    store.acknowledgeSend('owner-a', reservation.id, 'run-attachment');
    const response = await current.app.request(reservation.attachments[0].uri!);
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

  it('reports a settled graph without exposing an internal migration version', async () => {
    const current = await setup();
    const seeded = await seedPersistedArtifact(current);
    const response = await current.app.request(`/api/canvas/canvases/${seeded.canvas.id}/graph`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      hasPendingUpdates: false,
    }));
  });

  it('does not expose media hashes or replay internals in pending Send Operations', async () => {
    const current = await setup();
    const store = current.db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Pending media', { runtimeId: 'openclaw', profileId: 'main' });
    const branch = store.createRootBranch('owner-a', canvas.id);
    const attachment = await current.artifacts.persistCanvasAttachment('owner-a', canvas.id, {
      name: 'source.png',
      mimeType: 'image/png',
      bytes: Buffer.from('source'),
    });
    store.recordCanvasAttachment('owner-a', canvas.id, attachment);
    store.prepareSend('owner-a', {
      branchId: branch.id,
      userInput: 'inspect',
      attachments: [attachment],
    });

    const response = await current.app.request(`/api/canvas/canvases/${canvas.id}/graph`);
    const graph = await response.json() as {
      pendingSends: Array<Record<string, unknown> & { attachments: Array<Record<string, unknown>> }>;
    };

    expect(graph.pendingSends[0]).not.toHaveProperty('outgoingMessage');
    expect(graph.pendingSends[0]).not.toHaveProperty('bootstrapResources');
    expect(graph.pendingSends[0].attachments[0]).not.toHaveProperty('contentHash');
  });

  it('reports pending runtime work without making Graph reads start reconciliation', async () => {
    const current = await setup();
    const store = current.db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Pending', { runtimeId: 'openclaw', profileId: 'main' });
    const branch = store.createRootBranch('owner-a', canvas.id);
    const reservation = store.prepareSend('owner-a', { branchId: branch.id, userInput: 'create', attachments: [] });
    const interaction = store.acknowledgeSend('owner-a', reservation.id, 'run-pending');
    const before = store.getOwnedInteraction('owner-a', interaction.id)!;

    const response = await current.app.request(`/api/canvas/canvases/${canvas.id}/graph`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ hasPendingUpdates: true }));
    expect(store.getOwnedInteraction('owner-a', interaction.id)?.sessionMetadata).toEqual(before.sessionMetadata);
  });

  it('does not expose a frontend terminal mutation endpoint', async () => {
    const current = await setup();
    const store = current.db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Terminal hint', { runtimeId: 'openclaw', profileId: 'main' });
    const branch = store.createRootBranch('owner-a', canvas.id);
    const reservation = store.prepareSend('owner-a', { branchId: branch.id, userInput: 'edit image', attachments: [] });
    const interaction = store.acknowledgeSend('owner-a', reservation.id, 'run-terminal');

    const response = await current.app.request(`/api/canvas/interactions/${interaction.id}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terminalHint: true, runId: 'run-terminal' }),
    });

    expect(response.status).toBe(404);
    current.reconciler.stopCanvasReconciler();
    expect(store.getOwnedInteraction('owner-a', interaction.id)).toEqual(expect.objectContaining({
      status: 'streaming',
      agentOutput: '',
      artifacts: [],
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
