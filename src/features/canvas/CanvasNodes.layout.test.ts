import type { Edge } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import {
  autoLayoutCanvasNodes,
  type CanvasFlowNode,
} from './CanvasNodes';
import {
  DEFAULT_NODE_HEIGHT,
  INTERACTION_NODE_WIDTH,
  NODE_HORIZONTAL_GAP,
  NODE_VERTICAL_GAP,
} from './layout';

function flowNode(
  id: string,
  measured?: { width: number; height: number },
): CanvasFlowNode {
  return {
    id,
    type: 'interaction',
    position: { x: 0, y: 0 },
    ...(measured ? { measured } : {}),
    data: {
      interaction: {
        id,
        version: 1,
        branchId: id,
        parentInteractionId: null,
        runId: null,
        userInput: '',
        agentOutput: '',
        status: 'completed',
        executionState: 'completed',
        artifactSyncState: 'synced',
        terminalAt: 1,
        error: null,
        attachments: [],
        artifacts: [],
        sessionMetadata: {},
        contextSnapshot: null,
        createdAt: 1,
        updatedAt: 1,
      },
      preview: '',
      composerOpen: false,
      canAdd: false,
      onAdd: () => undefined,
    },
  };
}

function edge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target };
}

describe('Canvas automatic topology layout', () => {
  it('places descendants from left to right using the configured horizontal gap', () => {
    const [root, child] = autoLayoutCanvasNodes(
      [flowNode('root'), flowNode('child')],
      [edge('root', 'child')],
    );

    expect(child.position.x).toBe(
      root.position.x + INTERACTION_NODE_WIDTH + NODE_HORIZONTAL_GAP,
    );
  });

  it('uses measured heights to separate parallel branches from top to bottom', () => {
    const arranged = autoLayoutCanvasNodes([
      flowNode('root', { width: 380, height: 220 }),
      flowNode('short', { width: 380, height: 180 }),
      flowNode('tall', { width: 380, height: 620 }),
    ], [
      edge('root', 'short'),
      edge('root', 'tall'),
    ]);
    const branches = arranged
      .filter((node) => node.id !== 'root')
      .sort((left, right) => left.position.y - right.position.y);
    const upperHeight = branches[0].measured?.height || DEFAULT_NODE_HEIGHT;

    expect(branches[1].position.y).toBeGreaterThanOrEqual(
      branches[0].position.y + upperHeight + NODE_VERTICAL_GAP,
    );
  });

  it('falls back to default dimensions and returns stable coordinates', () => {
    const nodes = [flowNode('root'), flowNode('first'), flowNode('second')];
    const edges = [edge('root', 'first'), edge('root', 'second')];

    expect(autoLayoutCanvasNodes(nodes, edges)).toEqual(
      autoLayoutCanvasNodes(nodes, edges),
    );
    expect(autoLayoutCanvasNodes(nodes, edges).every((node) => (
      Number.isFinite(node.position.x) && Number.isFinite(node.position.y)
    ))).toBe(true);
  });
});
