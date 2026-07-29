import { describe, expect, it } from 'vitest';
import {
  COMPOSER_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  INTERACTION_NODE_WIDTH,
  NODE_HORIZONTAL_GAP,
  NODE_VERTICAL_GAP,
  canvasLayoutNodes,
  canvasLayoutPositions,
  canvasLayoutSizes,
  composerNodeId,
  mergeVisibleNodePositions,
  mergeVisibleNodeSizes,
  placeNodeToRight,
  placeRootNode,
  type CanvasNodeBounds,
} from './layout';

function node(id: string, x: number, y: number, width = INTERACTION_NODE_WIDTH, height = DEFAULT_NODE_HEIGHT): CanvasNodeBounds {
  return { id, position: { x, y }, width, height };
}

describe('Canvas node placement', () => {
  it('uses a new composer identity when a branch advances to a new source interaction', () => {
    expect(composerNodeId('branch-1', null)).toBe('composer:branch-1:root');
    expect(composerNodeId('branch-1', 'interaction-1')).toBe('composer:branch-1:interaction-1');
    expect(composerNodeId('branch-1', 'interaction-2')).not.toBe(composerNodeId('branch-1', 'interaction-1'));
  });

  it('removes stale composer positions without discarding interaction positions', () => {
    expect(mergeVisibleNodePositions({
      'interaction-1': { x: 100, y: 80 },
      'composer:branch-1:root': { x: 100, y: 80 },
    }, {
      'interaction-1': { x: 100, y: 80 },
      'composer:branch-1:interaction-1': { x: 590, y: 80 },
    })).toEqual({
      'interaction-1': { x: 100, y: 80 },
      'composer:branch-1:interaction-1': { x: 590, y: 80 },
    });
  });

  it('round-trips optional custom sizes while keeping old position-only layouts compatible', () => {
    const layoutNodes = {
      'interaction-1': { x: 100, y: 80, width: 640, height: 520 },
      'interaction-2': { x: 590, y: 80 },
    };
    const positions = canvasLayoutPositions(layoutNodes);
    const sizes = canvasLayoutSizes(layoutNodes);

    expect(positions).toEqual({
      'interaction-1': { x: 100, y: 80 },
      'interaction-2': { x: 590, y: 80 },
    });
    expect(sizes).toEqual({
      'interaction-1': { width: 640, height: 520 },
    });
    expect(canvasLayoutNodes(positions, sizes)).toEqual(layoutNodes);
  });

  it('removes stale Composer sizes without discarding persistent Interaction sizes', () => {
    expect(mergeVisibleNodeSizes({
      'interaction-1': { width: 640, height: 520 },
      'composer:branch-1:root': { width: 500, height: 480 },
    }, ['interaction-1', 'composer:branch-1:interaction-1'])).toEqual({
      'interaction-1': { width: 640, height: 520 },
    });
  });

  it('places a continuation directly to the right of its completed interaction', () => {
    const source = node('source', 120, 80);
    expect(placeNodeToRight(source, [source])).toEqual({
      x: 120 + INTERACTION_NODE_WIDTH + NODE_HORIZONTAL_GAP,
      y: 80,
    });
  });

  it('places a fork below an existing downstream node using its actual height', () => {
    const source = node('source', 0, 40);
    const downstream = node('downstream', INTERACTION_NODE_WIDTH + NODE_HORIZONTAL_GAP, 40, INTERACTION_NODE_WIDTH, 520);

    expect(placeNodeToRight(source, [source, downstream])).toEqual({
      x: INTERACTION_NODE_WIDTH + NODE_HORIZONTAL_GAP,
      y: 40 + 520 + NODE_VERTICAL_GAP,
    });
  });

  it('stacks repeated forks sequentially below all nodes in the target column', () => {
    const targetX = INTERACTION_NODE_WIDTH + NODE_HORIZONTAL_GAP;
    const source = node('source', 0, 0);
    const first = node('first', targetX, 0);
    const second = node('second', targetX, DEFAULT_NODE_HEIGHT + NODE_VERTICAL_GAP, COMPOSER_NODE_WIDTH, 240);

    expect(placeNodeToRight(source, [source, first, second])).toEqual({
      x: targetX,
      y: DEFAULT_NODE_HEIGHT + NODE_VERTICAL_GAP + 240 + NODE_VERTICAL_GAP,
    });
  });

  it('does not move a node for content in a different horizontal column', () => {
    const source = node('source', 0, 0);
    const elsewhere = node('elsewhere', 1_500, 0);
    expect(placeNodeToRight(source, [source, elsewhere]).y).toBe(0);
  });

  it('stacks independent root sessions in the left-most column', () => {
    const existingRoot = node('root', 0, 0);
    const downstream = node('downstream', 490, 0);
    expect(placeRootNode([existingRoot, downstream])).toEqual({
      x: 0,
      y: DEFAULT_NODE_HEIGHT + NODE_VERTICAL_GAP,
    });
  });
});
