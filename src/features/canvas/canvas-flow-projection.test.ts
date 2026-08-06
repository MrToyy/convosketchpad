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
    runtimeTurnId: `run-${id}`,
    userInput: id,
    agentOutput: `answer-${id}`,
    status: 'completed',
    executionState: 'completed',
    artifactSyncState: 'synced',
    terminalAt: 2,
    error: null,
    attachments: [],
    artifacts: [],
    approvals: [],
    executionMetadata: {},
    contextSnapshot: null,
    createdAt: 1,
    updatedAt: 2,
  };
}

function project(graph: CanvasGraph) {
  return projectCanvasFlow({
    graph,
    renderedNodes: [],
    positions: {},
    sizes: {},
    resizeEnabled: true,
    drafts: {},
    resubmittingInteractionIds: new Set(),
    previews: {},
    labels: {
      createBranch: 'Create branch',
      newSession: 'New session',
      continueBranch: 'Continue',
    },
    onAdd: vi.fn(),
    onResubmit: vi.fn(),
    onTextChange: vi.fn(),
    onFiles: vi.fn(),
    onRemoveFile: vi.fn(),
    onRemovePersistedAttachment: vi.fn(),
    onSend: vi.fn(),
    onFocus: vi.fn(),
    onBlur: vi.fn(),
  });
}

describe('Canvas flow projection', () => {
  it('projects continuation and draft Fork composers without embedding controller state', () => {
    const graph: CanvasGraph = {
      cursor: 1,
      canvas: {
        id: 'canvas-1',
        name: 'Canvas',
        agentRef: { runtimeId: 'openclaw', profileId: 'main' },
        agentMutable: false,
        createdAt: 1,
        updatedAt: 1,
      },
      branches: [{
        id: 'branch-root',
        canvasId: 'canvas-1',
        kind: 'root',
        parentBranchId: null,
        forkedFromInteractionId: null,
        conversationId: 'root-session',
        conversationInstanceId: 'session-1',
        observedConversationInstanceId: 'session-1',
        conversationIntegrity: 'healthy',
        conversationState: 'active',
        creationMode: 'composer',
        headInteractionId: 'interaction-2',
        createdAt: 1,
        updatedAt: 1,
      }, {
        id: 'branch-fork',
        canvasId: 'canvas-1',
        kind: 'fork',
        parentBranchId: 'branch-root',
        forkedFromInteractionId: 'interaction-1',
        conversationId: 'fork-session',
        conversationInstanceId: null,
        observedConversationInstanceId: null,
        conversationIntegrity: 'unknown',
        conversationState: 'draft',
        creationMode: 'composer',
        headInteractionId: null,
        createdAt: 2,
        updatedAt: 2,
      }, {
        id: 'branch-direct',
        canvasId: 'canvas-1',
        kind: 'fork',
        parentBranchId: 'branch-root',
        forkedFromInteractionId: 'interaction-1',
        conversationId: 'direct-session',
        conversationInstanceId: null,
        observedConversationInstanceId: null,
        conversationIntegrity: 'unknown',
        conversationState: 'draft',
        creationMode: 'direct-submit',
        headInteractionId: null,
        createdAt: 3,
        updatedAt: 3,
      }],
      interactions: [
        interaction('interaction-1', null),
        interaction('interaction-2', 'interaction-1'),
      ],
      layout: null,
      pendingSends: [{
        id: 'operation-direct',
        branchId: 'branch-direct',
        expectedHeadInteractionId: null,
        userInput: 'retry interaction 2',
        attachments: [],
        materialization: 'canonical-replay',
        conversationId: 'direct-session',
        status: 'prepared',
        dispatchState: 'reserved',
        attemptCount: 0,
        lastAttemptAt: null,
        nextAttemptAt: null,
        error: null,
        interactionId: null,
        createdAt: 3,
        updatedAt: 3,
      }],
      failedSends: [],
      hasPendingUpdates: false,
    };
    const result = project(graph);
    expect(result.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      'interaction-1',
      'interaction-2',
      'composer:branch-root:interaction-2',
      'composer:branch-fork:interaction-1',
      'composer:branch-direct:interaction-1',
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
    expect(result.edges.every((edge) => edge.animated !== true)).toBe(true);
    expect(result.nodes.find((node) => node.id === 'composer:branch-direct:interaction-1'))
      .toMatchObject({
        data: {
          draft: {
            text: 'retry interaction 2',
            sending: true,
          },
        },
      });
  });

  it('opens Fork on the previous head as soon as an accepted continuation becomes the new head', () => {
    const previous = interaction('interaction-1', null);
    const accepted = {
      ...interaction('interaction-2', previous.id),
      agentOutput: '',
      status: 'streaming' as const,
      executionState: 'running' as const,
      artifactSyncState: 'not_started' as const,
      terminalAt: null,
    };
    const graph: CanvasGraph = {
      cursor: 2,
      canvas: {
        id: 'canvas-1',
        name: 'Canvas',
        agentRef: { runtimeId: 'openclaw', profileId: 'main' },
        agentMutable: false,
        createdAt: 1,
        updatedAt: 2,
      },
      branches: [{
        id: 'branch-root',
        canvasId: 'canvas-1',
        kind: 'root',
        parentBranchId: null,
        forkedFromInteractionId: null,
        conversationId: 'root-session',
        conversationInstanceId: 'session-1',
        observedConversationInstanceId: 'session-1',
        conversationIntegrity: 'healthy',
        conversationState: 'active',
        creationMode: 'composer',
        headInteractionId: accepted.id,
        createdAt: 1,
        updatedAt: 2,
      }],
      interactions: [previous, accepted],
      layout: {
        nodes: {
          'composer:branch-root:interaction-1': {
            x: 490,
            y: 30,
            width: 700,
            height: 560,
          },
        },
      },
      pendingSends: [],
      failedSends: [],
      hasPendingUpdates: true,
    };

    const result = project(graph);

    expect(result.nodes.find((node) => node.id === previous.id)).toMatchObject({
      data: { canAdd: true },
    });
    expect(result.nodes.find((node) => node.id === accepted.id)).toMatchObject({
      width: 700,
      height: 560,
      position: { x: 490, y: 30 },
      data: { canAdd: false },
    });
    expect(result.nodes.some((node) => node.type === 'composer')).toBe(false);
    expect(result.edges).toEqual([
      expect.objectContaining({
        source: previous.id,
        target: accepted.id,
      }),
    ]);
    expect(result.edges.every((edge) => edge.animated !== true)).toBe(true);
  });
});
