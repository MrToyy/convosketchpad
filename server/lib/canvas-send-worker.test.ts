import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  registerCanvasInteraction: vi.fn(),
  scheduleCanvasInteractionReconciliation: vi.fn(),
}));

let tempRoot = '';
let resetStore: (() => void) | null = null;

async function setup() {
  vi.resetModules();
  vi.doMock('./config.js', () => ({
    config: {
      canvasDatabasePath: path.join(tempRoot, 'canvas.sqlite'),
    },
  }));
  vi.doMock('./canvas-send-delivery.js', () => ({
    assertCanvasReplayPayloadFits: vi.fn(),
    buildCanvasDelivery: vi.fn(async (reservation: { outgoingMessage: string }) => ({
      message: reservation.outgoingMessage,
      attachments: [],
      bootstrapWarnings: [],
    })),
  }));
  vi.doMock('./canvas-media-derivatives.js', () => ({
    CANVAS_DELIVERY_MAX_BYTES: 1_800_000,
  }));
  vi.doMock('./canvas-gateway-events.js', () => ({
    handleCanvasGatewayEvent: vi.fn(),
    registerCanvasInteraction: mocks.registerCanvasInteraction,
  }));
  vi.doMock('./canvas-reconciler.js', () => ({
    scheduleCanvasInteractionReconciliation: mocks.scheduleCanvasInteractionReconciliation,
  }));
  vi.doMock('./openclaw-canvas.js', () => ({
    openClawCanvas: {
      send: mocks.send,
      supports: vi.fn(() => true),
      runtimeStatus: vi.fn(() => ({
        state: 'connected',
        gatewayRestartSupported: true,
        methods: ['chat.send'],
      })),
    },
  }));

  const db = await import('./canvas-db.js');
  const sync = await import('./canvas-sync.js');
  const worker = await import('./canvas-send-worker.js');
  resetStore = db.resetCanvasStoreForTests;
  return { db, sync, worker };
}

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), 'convosketchpad-send-worker-'));
  mocks.send.mockReset();
  mocks.registerCanvasInteraction.mockReset();
  mocks.scheduleCanvasInteractionReconciliation.mockReset();
});

afterEach(() => {
  resetStore?.();
  resetStore = null;
  vi.restoreAllMocks();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('Canvas send worker', () => {
  it('publishes the Canvas head change as soon as OpenClaw accepts the send', async () => {
    const { db, sync, worker } = await setup();
    const store = db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Canvas', 'main');
    const branch = store.createRootBranch('owner-a', canvas.id);
    const firstReservation = store.prepareSend('owner-a', {
      branchId: branch.id,
      userInput: 'first',
      attachments: [],
    });
    const first = store.acknowledgeSend('owner-a', firstReservation.id, 'run-first');
    store.applyReconciledInteraction(first.id, {
      status: 'completed',
      agentOutput: 'first answer',
      artifacts: [],
      artifactSyncState: 'synced',
      artifactObservationPending: false,
      reconciliation: {
        phase: 'synced',
        artifactSync: 'synced',
      },
    });
    const continuation = store.prepareSend('owner-a', {
      branchId: branch.id,
      expectedHeadInteractionId: first.id,
      userInput: 'continue',
      attachments: [],
    });
    const signals: unknown[] = [];
    const unsubscribe = sync.subscribeCanvasSync((signal) => signals.push(signal));
    mocks.send.mockResolvedValue({ runId: 'run-continue' });

    const result = await worker.runCanvasSendWorker(continuation.id);

    unsubscribe();
    expect('agentOutput' in result).toBe(true);
    if (!('agentOutput' in result)) throw new Error('expected acknowledged interaction');
    expect(result).toMatchObject({
      branchId: branch.id,
      parentInteractionId: first.id,
      runId: 'run-continue',
      executionState: 'running',
    });
    expect(store.getOwnedBranch('owner-a', branch.id)).toMatchObject({
      headInteractionId: result.id,
      sessionState: 'active',
    });
    expect(signals).toContainEqual({
      kind: 'changed',
      ownerId: 'owner-a',
      canvasId: canvas.id,
    });
  });
});
