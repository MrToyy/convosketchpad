import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  capabilities: {} as Record<string, unknown>,
  dispatchTurn: vi.fn(),
  reconcileDispatch: vi.fn(),
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
    buildCanvasDelivery: vi.fn(async (reservation: { outgoingMessage: string }) => ({
      message: reservation.outgoingMessage,
      attachments: [],
      bootstrapWarnings: [],
    })),
  }));
  vi.doMock('./canvas-media-derivatives.js', () => ({
    CANVAS_DELIVERY_MAX_BYTES: 1_800_000,
  }));
  vi.doMock('./canvas/runtime-event-consumer.js', () => ({
    handleCanvasRuntimeEvent: vi.fn(),
    registerCanvasInteraction: mocks.registerCanvasInteraction,
  }));
  vi.doMock('./canvas-reconciler.js', () => ({
    scheduleCanvasInteractionReconciliation: mocks.scheduleCanvasInteractionReconciliation,
  }));
  vi.doMock('./agent-runtimes/registry.js', () => ({
    getAgentRuntime: () => ({
      id: 'openclaw',
      getCapabilities: vi.fn(async () => mocks.capabilities),
      getStatus: vi.fn(() => ({
        runtimeId: 'openclaw',
        state: 'connected',
      })),
      createConversationHandle: ({ profile, localConversationId }: {
        profile: { profileId: string };
        localConversationId: string;
      }) => ({
        runtimeId: 'openclaw',
        schemaVersion: 1,
        opaque: { sessionKey: `agent:${profile.profileId}:canvas:${localConversationId}` },
      }),
      dispatchTurn: mocks.dispatchTurn,
      reconcileDispatch: mocks.reconcileDispatch,
    }),
  }));

  const db = await import('./canvas-db.js');
  const sync = await import('./canvas-sync.js');
  const worker = await import('./canvas-send-worker.js');
  resetStore = db.resetCanvasStoreForTests;
  return { db, sync, worker };
}

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), 'convosketchpad-send-worker-'));
  mocks.capabilities = {
    input: { text: true },
    reliability: { idempotentDispatch: true, inspectAfterUnknownOutcome: false },
  };
  mocks.dispatchTurn.mockReset();
  mocks.reconcileDispatch.mockReset();
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
    const canvas = store.createCanvas('owner-a', 'Canvas', { runtimeId: 'openclaw', profileId: 'main' });
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
    mocks.dispatchTurn.mockResolvedValue({
      outcome: 'accepted',
      turnRef: {
        runtimeId: 'openclaw',
        schemaVersion: 1,
        opaque: { runId: 'run-continue' },
      },
    });

    const result = await worker.runCanvasSendWorker(continuation.id);

    unsubscribe();
    expect('agentOutput' in result).toBe(true);
    if (!('agentOutput' in result)) throw new Error('expected acknowledged interaction');
    expect(result).toMatchObject({
      branchId: branch.id,
      parentInteractionId: first.id,
      runtimeTurnId: null,
      turnRef: { runtimeId: 'openclaw', opaque: { runId: 'run-continue' } },
      executionState: 'running',
    });
    expect(store.getOwnedBranch('owner-a', branch.id)).toMatchObject({
      headInteractionId: result.id,
      conversationState: 'active',
    });
    expect(signals).toContainEqual({
      kind: 'changed',
      ownerId: 'owner-a',
      canvasId: canvas.id,
    });
  });

  it('persists a recovery handle when dispatch outcome is unknown', async () => {
    const { db, worker } = await setup();
    const store = db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Canvas', { runtimeId: 'openclaw', profileId: 'main' });
    const branch = store.createRootBranch('owner-a', canvas.id);
    const reservation = store.prepareSend('owner-a', {
      branchId: branch.id,
      userInput: 'unknown',
      attachments: [],
    });
    const recoveryRef = {
      runtimeId: 'openclaw',
      schemaVersion: 1,
      opaque: { requestId: 'request-1' },
    };
    mocks.dispatchTurn.mockResolvedValue({
      outcome: 'unknown',
      error: new Error('outcome unknown'),
      recoveryRef,
    });

    await worker.runCanvasSendWorker(reservation.id);

    expect(store.getReservation(reservation.id)).toMatchObject({
      status: 'prepared',
      dispatchState: 'ambiguous',
      dispatchRecoveryRef: recoveryRef,
    });
  });

  it('does not redispatch an ambiguous non-idempotent turn without inspection', async () => {
    const { db, worker } = await setup();
    const store = db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Canvas', { runtimeId: 'openclaw', profileId: 'main' });
    const branch = store.createRootBranch('owner-a', canvas.id);
    const reservation = store.prepareSend('owner-a', {
      branchId: branch.id,
      userInput: 'do not duplicate',
      attachments: [],
    });
    store.scheduleReservationRetry(reservation.id, 'ambiguous', 'unknown', Date.now(), {
      runtimeId: 'openclaw', schemaVersion: 1, opaque: { requestId: 'request-1' },
    });
    mocks.capabilities = {
      input: { text: true },
      reliability: { idempotentDispatch: false, inspectAfterUnknownOutcome: false },
    };

    const result = await worker.runCanvasSendWorker(reservation.id);

    expect('dispatchState' in result && result.dispatchState).toBe('ambiguous');
    expect(mocks.dispatchTurn).not.toHaveBeenCalled();
    expect(mocks.reconcileDispatch).not.toHaveBeenCalled();
  });

  it('acknowledges an inspected non-idempotent turn without redispatching it', async () => {
    const { db, worker } = await setup();
    const store = db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Canvas', { runtimeId: 'openclaw', profileId: 'main' });
    const branch = store.createRootBranch('owner-a', canvas.id);
    const reservation = store.prepareSend('owner-a', {
      branchId: branch.id,
      userInput: 'inspect me',
      attachments: [],
    });
    store.scheduleReservationRetry(reservation.id, 'ambiguous', 'unknown', Date.now(), {
      runtimeId: 'openclaw', schemaVersion: 1, opaque: { requestId: 'request-1' },
    });
    mocks.capabilities = {
      input: { text: true },
      reliability: { idempotentDispatch: false, inspectAfterUnknownOutcome: true },
    };
    mocks.reconcileDispatch.mockResolvedValue({
      outcome: 'accepted',
      turnRef: { runtimeId: 'openclaw', schemaVersion: 1, opaque: { turnId: 'turn-1' } },
    });

    const result = await worker.runCanvasSendWorker(reservation.id);

    expect('agentOutput' in result).toBe(true);
    expect(mocks.reconcileDispatch).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: reservation.id,
      recoveryRef: expect.objectContaining({ opaque: { requestId: 'request-1' } }),
    }));
    expect(mocks.dispatchTurn).not.toHaveBeenCalled();
  });

  it('dispatches only after inspection proves an ambiguous turn was not accepted', async () => {
    const { db, worker } = await setup();
    const store = db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Canvas', { runtimeId: 'openclaw', profileId: 'main' });
    const branch = store.createRootBranch('owner-a', canvas.id);
    const reservation = store.prepareSend('owner-a', {
      branchId: branch.id,
      userInput: 'safe retry',
      attachments: [],
    });
    store.scheduleReservationRetry(reservation.id, 'ambiguous', 'unknown', Date.now(), {
      runtimeId: 'openclaw', schemaVersion: 1, opaque: { requestId: 'request-1' },
    });
    mocks.capabilities = {
      input: { text: true },
      reliability: { idempotentDispatch: false, inspectAfterUnknownOutcome: true },
    };
    mocks.reconcileDispatch.mockResolvedValue({ outcome: 'not_found' });
    mocks.dispatchTurn.mockResolvedValue({ outcome: 'accepted', turnRef: null });

    const result = await worker.runCanvasSendWorker(reservation.id);

    expect('agentOutput' in result).toBe(true);
    expect(mocks.reconcileDispatch).toHaveBeenCalledOnce();
    expect(mocks.dispatchTurn).toHaveBeenCalledOnce();
    expect(store.getReservation(reservation.id)?.dispatchRecoveryRef).toBeNull();
  });
});
