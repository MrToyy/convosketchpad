import type { Edge, XYPosition } from '@xyflow/react';
import {
  autoLayoutCanvasNodes,
  canvasNodeBounds,
  type CanvasFlowNode,
} from './CanvasNodes';
import { EMPTY_CANVAS_DRAFT } from './constants';
import {
  COMPOSER_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  composerNodeId,
  placeNodeToRight,
  placeRootNode,
} from './layout';
import type {
  CanvasBranch,
  CanvasDraft,
  CanvasGraph,
  CanvasInteraction,
} from './types';

interface CanvasFlowProjectionInput {
  graph: CanvasGraph;
  renderedNodes: CanvasFlowNode[];
  positions: Record<string, XYPosition>;
  drafts: Record<string, CanvasDraft>;
  previews: Record<string, string>;
  labels: {
    createBranch: string;
    newSession: string;
    continueBranch: string;
  };
  onAdd(interaction: CanvasInteraction): void;
  onTextChange(branchId: string, value: string): void;
  onFiles(branchId: string, files: File[]): void;
  onRemoveFile(branchId: string, index: number): void;
  onSend(branch: CanvasBranch): void;
  onFocus(branchId: string, sourceInteractionId: string | null): void;
  onBlur(branchId: string): void;
}

export function projectCanvasFlow(input: CanvasFlowProjectionInput): {
  nodes: CanvasFlowNode[];
  edges: Edge[];
} {
  const {
    graph,
    renderedNodes,
    positions,
    drafts,
    previews,
    labels,
  } = input;
  const renderedById = new Map(renderedNodes.map((node) => [node.id, node]));
  const interactionById = new Map(graph.interactions.map((interaction) => [interaction.id, interaction]));
  const headIds = new Set(graph.branches.flatMap((branch) =>
    branch.headInteractionId ? [branch.headInteractionId] : []));
  const draftForkSources = new Set(graph.branches.flatMap((branch) =>
    branch.kind === 'fork' && branch.sessionState === 'draft' && branch.forkedFromInteractionId
      ? [branch.forkedFromInteractionId]
      : []));
  const pendingBranchIds = new Set(graph.pendingSends.map((operation) => operation.branchId));

  const interactionNodes: CanvasFlowNode[] = graph.interactions.map((interaction) => ({
    id: interaction.id,
    type: 'interaction',
    position: positions[interaction.id]
      || graph.layout?.nodes[interaction.id]
      || (headIds.has(interaction.id)
        ? positions[composerNodeId(interaction.branchId, interaction.parentInteractionId)]
        : undefined)
      || { x: 0, y: 0 },
    dragHandle: '.canvas-node-drag-handle',
    data: {
      interaction,
      preview: previews[interaction.id] || '',
      composerOpen: draftForkSources.has(interaction.id),
      canAdd:
        !headIds.has(interaction.id)
        && interaction.executionState === 'completed'
        && !draftForkSources.has(interaction.id),
      onAdd: input.onAdd,
    },
  }));
  const interactionNodeById = new Map(interactionNodes.map((node) => [node.id, node]));
  const edges: Edge[] = graph.interactions.flatMap((interaction) =>
    interaction.parentInteractionId
      ? [{
        id: `edge-${interaction.parentInteractionId}-${interaction.id}`,
        source: interaction.parentInteractionId,
        target: interaction.id,
        animated: interaction.executionState === 'running',
      }]
      : []);
  const composerNodes: CanvasFlowNode[] = [];

  for (const branch of graph.branches) {
    const isInitialDraft = branch.sessionState === 'draft';
    const head = branch.headInteractionId ? interactionById.get(branch.headInteractionId) : undefined;
    const isContinue = branch.sessionState === 'active' && head?.executionState === 'completed';
    if (!isInitialDraft && !isContinue) continue;
    const source = isInitialDraft ? branch.forkedFromInteractionId : branch.headInteractionId;
    const nodeId = composerNodeId(branch.id, source);
    if (source) {
      edges.push({
        id: `edge-${source}-${nodeId}`,
        source,
        target: nodeId,
        animated: true,
      });
    }
    const sourceNode = source ? interactionNodeById.get(source) : undefined;
    const occupied = [...interactionNodes, ...composerNodes]
      .map((node) => canvasNodeBounds(node, renderedById.get(node.id)));
    const defaultPosition = sourceNode
      ? placeNodeToRight(canvasNodeBounds(sourceNode, renderedById.get(sourceNode.id)), occupied, {
        width: COMPOSER_NODE_WIDTH,
        height: renderedById.get(nodeId)?.measured?.height || DEFAULT_NODE_HEIGHT,
      })
      : placeRootNode(occupied, {
        width: COMPOSER_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT,
      });
    composerNodes.push({
      id: nodeId,
      type: 'composer',
      position: positions[nodeId] || graph.layout?.nodes[nodeId] || defaultPosition,
      dragHandle: '.canvas-node-drag-handle',
      data: {
        branch,
        draft: pendingBranchIds.has(branch.id)
          ? { ...(drafts[branch.id] || EMPTY_CANVAS_DRAFT), sending: true }
          : drafts[branch.id] || EMPTY_CANVAS_DRAFT,
        label: branch.kind === 'fork' && branch.sessionState === 'draft'
          ? labels.createBranch
          : branch.sessionState === 'draft'
            ? labels.newSession
            : labels.continueBranch,
        onTextChange: (value) => input.onTextChange(branch.id, value),
        onFiles: (files) => input.onFiles(branch.id, files),
        onRemoveFile: (index) => input.onRemoveFile(branch.id, index),
        onSend: () => input.onSend(branch),
        onFocus: () => input.onFocus(branch.id, source),
        onBlur: () => input.onBlur(branch.id),
      },
    });
  }
  const all = [...interactionNodes, ...composerNodes];
  const hasSavedLayout = Boolean(
    Object.keys(positions).length
    || (graph.layout && Object.keys(graph.layout.nodes).length),
  );
  return {
    nodes: hasSavedLayout ? all : autoLayoutCanvasNodes(all, edges),
    edges,
  };
}
