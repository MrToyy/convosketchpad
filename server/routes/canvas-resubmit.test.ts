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

  const db = await import('../lib/canvas-db.js');
  const route = await import('./canvas.js');
  const app = new Hono();
  app.route('/', route.default);
  return { app, db };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-resubmit-route-'));
  mocks.dispatch.mockReset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('Canvas Interaction resubmit route', () => {
  it('creates a normal direct-submit root without changing the source Interaction', async () => {
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
    mocks.dispatch.mockImplementation(async (reservationId: string) =>
      store.acknowledgeSend('owner-a', reservationId, 'run-resubmitted'));

    const response = await current.app.request(
      `/api/canvas/interactions/${source.id}/resubmit`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedAgentRef: { runtimeId: 'openclaw', profileId: 'main' } }),
      },
    );
    const payload = await response.json() as {
      interaction: { id: string; branchId: string; parentInteractionId: string | null };
    };

    expect(response.status).toBe(201);
    expect(payload.interaction.parentInteractionId).toBeNull();
    expect(store.getOwnedBranch('owner-a', payload.interaction.branchId)).toMatchObject({
      kind: 'root',
      creationMode: 'direct-submit',
      conversationState: 'active',
    });
    expect(store.getOwnedInteraction('owner-a', source.id)).toMatchObject({
      id: source.id,
      executionState: 'running',
      runtimeTurnId: 'run-source',
    });
  });
});
