import { describe, expect, it, vi } from 'vitest';
import { projectCanvasFlow } from './canvas-flow-projection';
import type { CanvasGraph, CanvasInteraction } from './types';

function interaction(
  id: string,
  parentInteractionId: string | null,
): CanvasInteraction {
  return {
    id,
    version: 1,
    branchId: 'branch-root',
    parentInteractionId,
    runId: `run-${id}`,
    userInput: id,
    agentOutput: `answer-${id}`,
    status: 'completed',
    executionState: 'completed',
    artifactSyncState: 'synced',
    terminalAt: 2,
    error: null,
    attachments: [],
    artifacts: [],
    sessionMetadata: {},
    contextSnapshot: null,
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('Canvas flow projection', () => {
  it('projects continuation and draft Fork composers without embedding controller state', () => {
    const graph: CanvasGraph = {
      cursor: 1,
      canvas: {
        id: 'canvas-1',
        name: 'Canvas',
        agentId: 'main',
        createdAt: 1,
        updatedAt: 1,
      },
      branches: [{
        id: 'branch-root',
        canvasId: 'canvas-1',
        kind: 'root',
        parentBranchId: null,
        forkedFromInteractionId: null,
        sessionKey: 'root-session',
        openClawSessionId: 'session-1',
        observedSessionId: 'session-1',
        sessionIntegrity: 'healthy',
        sessionState: 'active',
        headInteractionId: 'interaction-2',
        createdAt: 1,
        updatedAt: 1,
      }, {
        id: 'branch-fork',
        canvasId: 'canvas-1',
        kind: 'fork',
        parentBranchId: 'branch-root',
        forkedFromInteractionId: 'interaction-1',
        sessionKey: 'fork-session',
        openClawSessionId: null,
        observedSessionId: null,
        sessionIntegrity: 'unknown',
        sessionState: 'draft',
        headInteractionId: null,
        createdAt: 2,
        updatedAt: 2,
      }],
      interactions: [
        interaction('interaction-1', null),
        interaction('interaction-2', 'interaction-1'),
      ],
      layout: null,
      pendingSends: [],
      hasPendingUpdates: false,
    };
    const result = projectCanvasFlow({
      graph,
      renderedNodes: [],
      positions: {},
      drafts: {},
      previews: {},
      labels: {
        createBranch: 'Create branch',
        newSession: 'New session',
        continueBranch: 'Continue',
      },
      onAdd: vi.fn(),
      onTextChange: vi.fn(),
      onFiles: vi.fn(),
      onRemoveFile: vi.fn(),
      onSend: vi.fn(),
      onFocus: vi.fn(),
      onBlur: vi.fn(),
    });
    expect(result.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      'interaction-1',
      'interaction-2',
      'composer:branch-root:interaction-2',
      'composer:branch-fork:interaction-1',
    ]));
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'interaction-1', target: 'interaction-2' }),
      expect.objectContaining({
        source: 'interaction-1',
        target: 'composer:branch-fork:interaction-1',
      }),
      expect.objectContaining({
        source: 'interaction-2',
        target: 'composer:branch-root:interaction-2',
      }),
    ]));
  });
});
