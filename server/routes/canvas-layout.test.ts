import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';

let tempRoot = '';
let resetStore: (() => void) | null = null;

async function setup() {
  vi.resetModules();
  vi.doMock('../lib/config.js', () => ({
    config: {
      auth: false,
      canvasDatabasePath: path.join(tempRoot, 'canvas.sqlite'),
      canvasArtifactsPath: path.join(tempRoot, 'artifacts'),
      gatewayTimezone: 'UTC',
    },
    SESSION_COOKIE_NAME: 'convosketchpad_session_test',
  }));
  vi.doMock('../lib/canvas-auth.js', () => ({
    getCanvasIdentity: () => ({ userId: 'owner-a', name: 'Owner A' }),
  }));
  vi.doMock('../middleware/rate-limit.js', () => ({
    rateLimitGeneral: async (_context: unknown, next: () => Promise<void>) => next(),
  }));
  vi.doMock('../lib/canvas-send-coordinator.js', () => ({
    dispatchCanvasSend: vi.fn(),
  }));

  const db = await import('../lib/canvas-db.js');
  const route = await import('./canvas.js');
  const app = new Hono();
  app.route('/', route.default);
  resetStore = db.resetCanvasStoreForTests;
  return { app, db };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-layout-route-'));
});

afterEach(async () => {
  resetStore?.();
  resetStore = null;
  vi.restoreAllMocks();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('Canvas layout route', () => {
  it('keeps position-only layouts compatible and persists bounded node dimensions', async () => {
    const { app, db } = await setup();
    const store = db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Canvas', { backendId: 'openclaw', profileId: 'main' });

    const oldLayoutResponse = await app.request(`/api/canvas/canvases/${canvas.id}/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: { 'interaction-1': { x: 100, y: 80 } },
      }),
    });
    expect(oldLayoutResponse.status).toBe(200);

    const resizedLayout = {
      nodes: {
        'interaction-1': {
          x: 100,
          y: 80,
          width: 640,
          height: 520,
        },
      },
      viewport: { x: -20, y: -30, zoom: 0.8 },
    };
    const resizedLayoutResponse = await app.request(
      `/api/canvas/canvases/${canvas.id}/layout`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resizedLayout),
      },
    );

    expect(resizedLayoutResponse.status).toBe(200);
    expect(store.getGraph('owner-a', canvas.id)?.layout).toEqual(resizedLayout);
  });

  it.each([
    { x: 0, y: 0, width: 640 },
    { x: 0, y: 0, width: 319, height: 520 },
    { x: 0, y: 0, width: 640, height: 901 },
  ])('rejects incomplete or out-of-range dimensions: %j', async (node) => {
    const { app, db } = await setup();
    const store = db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Canvas', { backendId: 'openclaw', profileId: 'main' });

    const response = await app.request(`/api/canvas/canvases/${canvas.id}/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: { 'interaction-1': node } }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid layout' });
  });
});
