import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
}));

let tempRoot = '';

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
    rateLimitGeneral: async (_c: unknown, next: () => Promise<void>) => next(),
  }));
  vi.doMock('../lib/canvas-send-coordinator.js', () => ({
    dispatchCanvasSend: mocks.dispatch,
  }));

  const db = await import('../lib/canvas/persistence/canvas-store.js');
  const { testConversationHandleFactory } = await import('../lib/fixtures/test-conversation-handle.js');
  db.getCanvasStore(testConversationHandleFactory);
  const route = await import('./canvas.js');
  const app = new Hono();
  app.route('/', route.createCanvasRoutes({
    store: db.getCanvasStore(),
    runtimes: { get: vi.fn(), list: () => [] } as never,
    dispatchSend: mocks.dispatch,
  }));
  return { app, db };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-copy-route-'));
  mocks.dispatch.mockReset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('Canvas Interaction copy route', () => {
  it('creates an editable root Composer without changing or submitting the source Interaction', async () => {
    const current = await setup();
    const store = current.db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Canvas', { runtimeId: 'openclaw', profileId: 'main' });
    const branch = store.createRootBranch('owner-a', canvas.id);
    const reservation = store.prepareSend('owner-a', {
      branchId: branch.id,
      userInput: 'try this',
      attachments: [],
    });
    const source = store.acknowledgeSend('owner-a', reservation.id, 'run-source');
    const response = await current.app.request(
      `/api/canvas/interactions/${source.id}/copy`,
      { method: 'POST' },
    );
    const payload = await response.json() as {
      branch: { id: string; creationMode: string; conversationState: string };
      initialDraft: { agentRef: { runtimeId: string; profileId: string }; inputDocument: unknown };
    };

    expect(response.status).toBe(201);
    expect(store.getOwnedBranch('owner-a', payload.branch.id)).toMatchObject({
      kind: 'root',
      creationMode: 'copy',
      copiedFromInteractionId: source.id,
      conversationState: 'draft',
    });
    expect(payload.initialDraft).toMatchObject({
      agentRef: { runtimeId: 'openclaw', profileId: 'main' },
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(store.getOwnedInteraction('owner-a', source.id)).toMatchObject({
      id: source.id,
      executionState: 'running',
      runtimeTurnId: 'run-source',
    });
  });
});
