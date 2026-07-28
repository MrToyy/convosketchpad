import { describe, expect, it } from 'vitest';
import { applyCanvasSyncBatch, graphHasPendingUpdates } from './sync';
import type { CanvasGraph, CanvasInteraction, CanvasSyncBatch, SendReservation } from './types';

function interaction(overrides: Partial<CanvasInteraction> = {}): CanvasInteraction {
  return {
    id: 'interaction-1',
    version: 1,
    branchId: 'branch-1',
    parentInteractionId: null,
    runId: 'run-1',
    userInput: 'hello',
    agentOutput: '',
    status: 'streaming',
    executionState: 'running',
    artifactSyncState: 'not_started',
    terminalAt: null,
    error: null,
    attachments: [],
    artifacts: [],
    sessionMetadata: {},
    contextSnapshot: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function operation(overrides: Partial<SendReservation> = {}): SendReservation {
  return {
    id: 'operation-1',
    branchId: 'branch-1',
    expectedHeadInteractionId: null,
    userInput: 'hello',
    attachments: [],
    materialization: 'lazy-root',
    sessionKey: 'agent:main:canvas:branch-1',
    outgoingMessage: 'hello',
    bootstrapResources: [],
    status: 'prepared',
    dispatchState: 'dispatching',
    attemptCount: 1,
    lastAttemptAt: 1,
    nextAttemptAt: null,
    error: null,
    interactionId: null,
    ...overrides,
  };
}

function graph(): CanvasGraph {
  return {
    cursor: 1,
    canvas: { id: 'canvas-1', name: 'Canvas', agentId: 'main', createdAt: 1, updatedAt: 1 },
    hasPendingUpdates: true,
    branches: [{
      id: 'branch-1',
      canvasId: 'canvas-1',
      kind: 'root',
      parentBranchId: null,
      forkedFromInteractionId: null,
      sessionKey: 'agent:main:canvas:branch-1',
      openClawSessionId: null,
      observedSessionId: null,
      sessionIntegrity: 'unknown',
      sessionState: 'active',
      headInteractionId: 'interaction-1',
      createdAt: 1,
      updatedAt: 1,
    }],
    interactions: [interaction()],
    layout: null,
    pendingSends: [operation()],
  };
}

function batch(overrides: Partial<CanvasSyncBatch> = {}): CanvasSyncBatch {
  return {
    cursor: 2,
    branches: [],
    interactions: [],
    sendOperations: [],
    removed: { branchIds: [], interactionIds: [], sendOperationIds: [] },
    ...overrides,
  };
}

describe('Canvas sync projection', () => {
  it('applies full node upserts and removes terminal send operations', () => {
    const next = applyCanvasSyncBatch(graph(), batch({
      interactions: [interaction({
        version: 2,
        status: 'completed',
        executionState: 'completed',
        artifactSyncState: 'observing',
        agentOutput: 'done',
      })],
      sendOperations: [operation({
        status: 'acknowledged',
        dispatchState: 'acknowledged',
        interactionId: 'interaction-1',
      })],
    }));
    expect(next.cursor).toBe(2);
    expect(next.interactions[0]).toMatchObject({
      version: 2,
      executionState: 'completed',
      artifactSyncState: 'observing',
      agentOutput: 'done',
    });
    expect(next.pendingSends).toEqual([]);
    expect(next.hasPendingUpdates).toBe(true);
  });

  it('ignores stale cursors and stale entity versions', () => {
    const current = graph();
    expect(applyCanvasSyncBatch(current, batch({ cursor: 1 }))).toBe(current);
    const newer = applyCanvasSyncBatch(current, batch({
      interactions: [interaction({ version: 0, agentOutput: 'stale' })],
    }));
    expect(newer.interactions[0].agentOutput).toBe('');
  });

  it('treats completed text and terminal Artifact sync as fully settled', () => {
    expect(graphHasPendingUpdates({
      interactions: [interaction({
        status: 'completed',
        executionState: 'completed',
        artifactSyncState: 'synced',
      })],
      pendingSends: [],
    })).toBe(false);
  });
});
