import type { XYPosition } from '@xyflow/react';

export const INTERACTION_NODE_WIDTH = 380;
export const COMPOSER_NODE_WIDTH = 360;
export const DEFAULT_NODE_HEIGHT = 300;
export const NODE_HORIZONTAL_GAP = 110;
export const NODE_VERTICAL_GAP = 80;

export interface CanvasNodeBounds {
  id: string;
  position: XYPosition;
  width: number;
  height: number;
}

interface PlacementSize {
  width?: number;
  height?: number;
}

function overlapsColumn(
  candidate: CanvasNodeBounds,
  occupied: CanvasNodeBounds,
): boolean {
  return candidate.position.x < occupied.position.x + occupied.width
    && candidate.position.x + candidate.width > occupied.position.x;
}

function overlapsRowWithGap(
  candidate: CanvasNodeBounds,
  occupied: CanvasNodeBounds,
): boolean {
  return candidate.position.y < occupied.position.y + occupied.height + NODE_VERTICAL_GAP
    && candidate.position.y + candidate.height + NODE_VERTICAL_GAP > occupied.position.y;
}

function findFreeVerticalSlot(
  initial: XYPosition,
  occupied: CanvasNodeBounds[],
  size: PlacementSize = {},
): XYPosition {
  const candidate: CanvasNodeBounds = {
    id: 'candidate',
    position: { ...initial },
    width: size.width ?? COMPOSER_NODE_WIDTH,
    height: size.height ?? DEFAULT_NODE_HEIGHT,
  };

  // Each pass moves below at least one blocker, so this remains deterministic
  // even when several branches already share the same downstream column.
  while (true) {
    const blockers = occupied.filter((node) => overlapsColumn(candidate, node) && overlapsRowWithGap(candidate, node));
    if (blockers.length === 0) return candidate.position;
    candidate.position = {
      x: initial.x,
      y: Math.max(...blockers.map((node) => node.position.y + node.height + NODE_VERTICAL_GAP)),
    };
  }
}

/** Place a continuation or fork to the right of its source, then stack it below occupied downstream nodes. */
export function placeNodeToRight(
  source: CanvasNodeBounds,
  occupied: CanvasNodeBounds[],
  size: PlacementSize = {},
): XYPosition {
  return findFreeVerticalSlot({
    x: source.position.x + source.width + NODE_HORIZONTAL_GAP,
    y: source.position.y,
  }, occupied.filter((node) => node.id !== source.id), size);
}

/** Place independent root sessions in a left-hand column, vertically separated from existing roots. */
export function placeRootNode(
  occupied: CanvasNodeBounds[],
  size: PlacementSize = {},
): XYPosition {
  if (occupied.length === 0) return { x: 0, y: 0 };
  const left = Math.min(0, ...occupied.map((node) => node.position.x));
  return findFreeVerticalSlot({ x: left, y: 0 }, occupied, size);
}
