import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import {
  COMPOSER_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  INTERACTION_NODE_WIDTH,
  NODE_HORIZONTAL_GAP,
  NODE_VERTICAL_GAP,
  type CanvasNodeBounds,
} from './layout';
import type { CanvasBranch, CanvasDraft, CanvasInteraction } from './types';

export interface InteractionNodeData extends Record<string, unknown> {
  interaction: CanvasInteraction;
  preview: string;
  composerOpen: boolean;
  canAdd: boolean;
  resubmitting: boolean;
  resizeEnabled: boolean;
  onAdd: (interaction: CanvasInteraction) => void;
  onResubmit: (interaction: CanvasInteraction) => void;
  onApprovalChanged: () => void;
}

export interface ComposerNodeData extends Record<string, unknown> {
  branch: CanvasBranch;
  draft: CanvasDraft;
  label: string;
  resizeEnabled: boolean;
  onTextChange: (value: string) => void;
  onFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  onRemovePersistedAttachment: (index: number) => void;
  onSend: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onClose?: () => void;
}

export type InteractionFlowNode = Node<InteractionNodeData, 'interaction'>;
export type ComposerFlowNode = Node<ComposerNodeData, 'composer'>;
export type CanvasFlowNode = InteractionFlowNode | ComposerFlowNode;

export function autoLayoutCanvasNodes(nodes: CanvasFlowNode[], edges: Edge[]): CanvasFlowNode[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'LR',
    ranksep: NODE_HORIZONTAL_GAP,
    nodesep: NODE_VERTICAL_GAP,
    marginx: 40,
    marginy: 40,
  });
  nodes.forEach((node) => {
    const fallbackWidth = node.type === 'composer' ? COMPOSER_NODE_WIDTH : INTERACTION_NODE_WIDTH;
    graph.setNode(node.id, {
      width: node.width || node.measured?.width || fallbackWidth,
      height: node.height || node.measured?.height || DEFAULT_NODE_HEIGHT,
    });
  });
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  return nodes.map((node) => {
    const position = graph.node(node.id) as { x: number; y: number };
    const fallbackWidth = node.type === 'composer' ? COMPOSER_NODE_WIDTH : INTERACTION_NODE_WIDTH;
    const width = node.width || node.measured?.width || fallbackWidth;
    const height = node.height || node.measured?.height || DEFAULT_NODE_HEIGHT;
    return { ...node, position: { x: position.x - width / 2, y: position.y - height / 2 } };
  });
}

export function canvasNodeBounds(node: CanvasFlowNode, rendered?: CanvasFlowNode): CanvasNodeBounds {
  const fallbackWidth = node.type === 'composer' ? COMPOSER_NODE_WIDTH : INTERACTION_NODE_WIDTH;
  return {
    id: node.id,
    position: node.position,
    width: rendered?.width || node.width || rendered?.measured?.width
      || node.measured?.width || fallbackWidth,
    height: rendered?.height || node.height || rendered?.measured?.height
      || node.measured?.height || DEFAULT_NODE_HEIGHT,
  };
}
