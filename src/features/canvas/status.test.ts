import { describe, expect, it } from 'vitest';
import { contextForComposerSource, deriveCanvasStatusCounts } from './status';
import type { CanvasGraph, CanvasInteraction, SendReservation } from './types';

function interaction(branchId: string, executionState: CanvasInteraction['executionState']): CanvasInteraction {
  return {
    id: `interaction-${branchId}-${executionState}`,
    version: 1,
    branchId,
    parentInteractionId: null,
    runtimeTurnId: null,
    userInput: '',
    agentOutput: '',
    status: executionState === 'running' ? 'streaming' : executionState === 'failed' ? 'failed' : 'completed',
    executionState,
    artifactSyncState: 'not_started',
    terminalAt: null,
    error: null,
    attachments: [],
    artifacts: [],
    approvals: [],
    executionMetadata: {},
    contextSnapshot: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function operation(branchId: string): SendReservation {
  return {
    id: `operation-${branchId}`,
    branchId,
    expectedHeadInteractionId: null,
    userInput: '',
    attachments: [],
    materialization: 'lazy-root',
    conversationId: `agent:main:canvas:${branchId}`,
    status: 'prepared',
    dispatchState: 'reserved',
    attemptCount: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    error: null,
    interactionId: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function graph(): Pick<CanvasGraph, 'branches' | 'interactions' | 'pendingSends'> {
  return {
    branches: ['branch-1', 'branch-2', 'branch-3'].map((id) => ({
      id,
      canvasId: 'canvas-1',
      kind: 'root',
      parentBranchId: null,
      forkedFromInteractionId: null,
      conversationId: `agent:main:canvas:${id}`,
      conversationInstanceId: null,
      observedConversationInstanceId: null,
      conversationIntegrity: 'unknown',
      conversationState: 'active',
      creationMode: 'composer',
      headInteractionId: null,
      createdAt: 1,
      updatedAt: 1,
    })),
    interactions: [
      interaction('branch-1', 'running'),
      interaction('branch-2', 'unconfirmed'),
      interaction('branch-3', 'completed'),
    ],
    pendingSends: [operation('branch-1'), operation('branch-3')],
  };
}

describe('Canvas status counts', () => {
  it('counts working branches once across sends and running interactions', () => {
    expect(deriveCanvasStatusCounts(graph())).toEqual({ branchCount: 3, workingCount: 2 });
  });

  it('does not classify unconfirmed or completed interactions as working', () => {
    const value = graph();
    value.pendingSends = [];
    expect(deriveCanvasStatusCounts(value)).toEqual({ branchCount: 3, workingCount: 1 });
  });

  it('returns empty counts without a selected graph', () => {
    expect(deriveCanvasStatusCounts(null)).toEqual({ branchCount: 0, workingCount: 0 });
  });

  it('uses only the Compose source Interaction cumulative snapshot', () => {
    const value = graph();
    value.interactions = [
      {
        ...interaction('branch-1', 'completed'),
        id: 'parent',
        contextSnapshot: {
          usedTokens: 7_000,
          contextLimit: 100_000,
          conversationId: 'agent:main:canvas:branch-1',
          sessionId: 'session-1',
          capturedAt: 1,
          source: 'openclaw-session',
        },
      },
      {
        ...interaction('branch-1', 'completed'),
        id: 'source',
        parentInteractionId: 'parent',
        contextSnapshot: {
          usedTokens: 12_000,
          contextLimit: 100_000,
          conversationId: 'agent:main:canvas:branch-1',
          sessionId: 'session-1',
          capturedAt: 2,
          source: 'openclaw-session',
        },
      },
    ];

    expect(contextForComposerSource(value, 'source')).toEqual({
      usedTokens: 12_000,
      contextLimit: 100_000,
    });
    expect(contextForComposerSource(value, null)).toBeUndefined();
    expect(contextForComposerSource(value, 'missing')).toBeUndefined();
  });
});
