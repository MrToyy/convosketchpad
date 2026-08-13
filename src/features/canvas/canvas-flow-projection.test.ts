import { describe, expect, it, vi } from 'vitest';
import { projectCanvasFlow } from './canvas-flow-projection';
import type { CanvasDraft, CanvasGraph, CanvasInteraction } from './types';

function interaction(
  id: string,
  parentInteractionId: string | null,
): CanvasInteraction {
  return {
    id,
    version: 1,
    branchId: 'branch-root',
    parentInteractionId,
    agentRef: { runtimeId: 'openclaw', profileId: 'main' },
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
    inputDocument: { version: 1, segments: [{ type: 'text', text: id }], references: [] },
    resourceReferences: [],
    createdAt: 1,
    updatedAt: 2,
  };
}

function project(graph: CanvasGraph, drafts: Record<string, CanvasDraft> = {}) {
  return projectCanvasFlow({
    graph,
    renderedNodes: [],
    positions: {},
    sizes: {},
    resizeEnabled: true,
    drafts,
    copyingInteractionIds: new Set(),
    previews: {},
    labels: {
      createBranch: 'Create branch',
      copiedDraft: 'Copied draft',
      newSession: 'New session',
      continueBranch: 'Continue',
      mergeSourceLabel: (index) => `Source ${index}`,
    },
    onAdd: vi.fn(),
    onCopy: vi.fn(),
    onApprovalChanged: vi.fn(),
    onOpenMergeTargets: vi.fn(),
    onDocumentChange: vi.fn(),
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
        createdAt: 1,
        updatedAt: 1,
      },
      branches: [{
        id: 'branch-root',
        canvasId: 'canvas-1',
        kind: 'root',
        parentBranchId: null,
        forkedFromInteractionId: null,
        copiedFromInteractionId: null,
        activeAgentRef: { runtimeId: 'openclaw', profileId: 'main' },
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
        copiedFromInteractionId: null,
        activeAgentRef: null,
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
        copiedFromInteractionId: 'interaction-2',
        activeAgentRef: null,
        conversationId: 'direct-session',
        conversationInstanceId: null,
        observedConversationInstanceId: null,
        conversationIntegrity: 'unknown',
        conversationState: 'draft',
        creationMode: 'copy',
        headInteractionId: null,
        createdAt: 3,
        updatedAt: 3,
      }],
      interactions: [
        interaction('interaction-1', null),
        interaction('interaction-2', 'interaction-1'),
        interaction('interaction-merge-source', null),
      ],
      layout: null,
      pendingSends: [{
        id: 'operation-direct',
        branchId: 'branch-direct',
        expectedHeadInteractionId: null,
        userInput: 'retry interaction 2',
        inputDocument: { version: 1, segments: [{ type: 'text', text: 'retry interaction 2' }], references: [] },
        resourceReferences: [],
        attachments: [],
        materialization: 'canonical-replay',
        agentRef: { runtimeId: 'openclaw', profileId: 'main' },
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
      mergeSources: [{
        id: 'merge-1',
        targetBranchId: 'branch-root',
        expectedHeadInteractionId: 'interaction-2',
        sourceInteractionId: 'interaction-1',
        targetInteractionId: null,
        ordinal: 0,
        createdAt: 4,
      }, {
        id: 'merge-copy',
        targetBranchId: 'branch-direct',
        expectedHeadInteractionId: null,
        sourceInteractionId: 'interaction-merge-source',
        targetInteractionId: null,
        ordinal: 0,
        createdAt: 5,
      }],
      hasPendingUpdates: false,
    };
    const result = project(graph);
    expect(result.needsInitialLayout).toBe(true);
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
      expect.objectContaining({
        id: 'merge-edge-merge-1',
        source: 'interaction-1',
        sourceHandle: 'merge-source',
        target: 'composer:branch-root:interaction-2',
        targetHandle: 'merge-target',
        deletable: false,
        style: { strokeWidth: 2 },
      }),
      expect.objectContaining({
        id: 'merge-edge-merge-copy',
        source: 'interaction-merge-source',
        target: 'composer:branch-direct:interaction-1',
        targetHandle: 'merge-target',
        deletable: false,
        style: { strokeWidth: 2 },
      }),
    ]));
    expect(result.edges.every((edge) => edge.animated !== true)).toBe(true);
    expect(result.nodes.find((node) => node.id === 'composer:branch-direct:interaction-1'))
      .toMatchObject({
        data: {
          label: 'Copied draft',
          draft: {
            agentRef: { runtimeId: 'openclaw', profileId: 'main' },
            text: 'retry interaction 2',
            sending: true,
          },
        },
      });

    const copiedBranch = graph.branches.find((branch) => branch.id === 'branch-direct');
    if (!copiedBranch) throw new Error('Expected copied branch');
    copiedBranch.conversationState = 'active';
    copiedBranch.activeAgentRef = { runtimeId: 'openclaw', profileId: 'main' };
    copiedBranch.headInteractionId = 'interaction-2';
    graph.pendingSends = [];
    const continuedProjection = project(graph);
    expect(continuedProjection.nodes.find(
      (node) => node.id === 'composer:branch-direct:interaction-2',
    )).toMatchObject({ data: { label: 'Continue' } });
    expect(continuedProjection.edges.some((edge) => edge.id === 'merge-edge-merge-copy')).toBe(false);
  });

  it('keeps an accepted merge edge visible on the generated Interaction target', () => {
    const source = interaction('interaction-source', null);
    const target = interaction('interaction-target', null);
    const graph: CanvasGraph = {
      cursor: 2,
      canvas: {
        id: 'canvas-1',
        name: 'Canvas',
        createdAt: 1,
        updatedAt: 2,
      },
      branches: [{
        id: 'branch-root',
        canvasId: 'canvas-1',
        kind: 'root',
        parentBranchId: null,
        forkedFromInteractionId: null,
        copiedFromInteractionId: null,
        activeAgentRef: { runtimeId: 'openclaw', profileId: 'main' },
        conversationId: 'root-session',
        conversationInstanceId: 'session-1',
        observedConversationInstanceId: 'session-1',
        conversationIntegrity: 'healthy',
        conversationState: 'active',
        creationMode: 'composer',
        headInteractionId: target.id,
        createdAt: 1,
        updatedAt: 2,
      }],
      interactions: [source, target],
      layout: null,
      pendingSends: [],
      failedSends: [],
      mergeSources: [{
        id: 'merge-accepted',
        targetBranchId: 'branch-root',
        expectedHeadInteractionId: null,
        sourceInteractionId: source.id,
        targetInteractionId: target.id,
        ordinal: 0,
        createdAt: 2,
      }],
      hasPendingUpdates: false,
    };

    const result = project(graph);
    const mergeEdge = result.edges.find((edge) => edge.id === 'merge-edge-merge-accepted');

    expect(mergeEdge).toMatchObject({
      source: source.id,
      sourceHandle: 'merge-source',
      target: target.id,
      style: { strokeWidth: 2 },
      deletable: false,
    });
    expect(mergeEdge?.targetHandle).toBeUndefined();
    expect(mergeEdge?.style).not.toHaveProperty('strokeDasharray');
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
        createdAt: 1,
        updatedAt: 2,
      },
      branches: [{
        id: 'branch-root',
        canvasId: 'canvas-1',
        kind: 'root',
        parentBranchId: null,
        forkedFromInteractionId: null,
        copiedFromInteractionId: null,
        activeAgentRef: { runtimeId: 'openclaw', profileId: 'main' },
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
      mergeSources: [],
      hasPendingUpdates: true,
    };

    const result = project(graph);

    expect(result.needsInitialLayout).toBe(false);
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
