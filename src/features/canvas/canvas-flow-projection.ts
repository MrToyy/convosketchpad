import type { Edge, XYPosition } from '@xyflow/react';
import {
  autoLayoutCanvasNodes,
  canvasNodeBounds,
  composerIncomingInteractionId,
  MERGE_SOURCE_HANDLE_ID,
  MERGE_TARGET_HANDLE_ID,
  type CanvasFlowNode,
} from './flow-model';
import { EMPTY_CANVAS_DRAFT } from './constants';
import {
  COMPOSER_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  INTERACTION_NODE_WIDTH,
  composerNodeId,
  placeNodeToRight,
  placeRootNode,
  type CanvasNodeSize,
} from './layout';
import type {
  CanvasBranch,
  CanvasDraft,
  CanvasDraftInputDocument,
  CanvasGraph,
  CanvasInteraction,
} from './types';

interface CanvasFlowProjectionInput {
  graph: CanvasGraph;
  renderedNodes: CanvasFlowNode[];
  positions: Record<string, XYPosition>;
  sizes: Record<string, CanvasNodeSize>;
  resizeEnabled: boolean;
  drafts: Record<string, CanvasDraft>;
  resubmittingInteractionIds: Set<string>;
  previews: Record<string, string>;
  labels: {
    createBranch: string;
    newSession: string;
    continueBranch: string;
    mergeSourceLabel: (index: number) => string;
  };
  onAdd(interaction: CanvasInteraction): void;
  onResubmit(interaction: CanvasInteraction): void;
  onApprovalChanged(): void;
  onNavigateMergeSource(interactionId: string): void;
  onOpenMergeTargets(interaction: CanvasInteraction): void;
  onDocumentChange(branchId: string, value: CanvasDraftInputDocument): void;
  onFiles(branchId: string, files: File[]): void;
  onRemoveFile(branchId: string, index: number): void;
  onRemovePersistedAttachment(branchId: string, index: number): void;
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
    sizes,
    drafts,
    previews,
    labels,
  } = input;
  const mergeSources = graph.mergeSources || [];
  const renderedById = new Map(renderedNodes.map((node) => [node.id, node]));
  const interactionById = new Map(graph.interactions.map((interaction) => [interaction.id, interaction]));
  const mergeSourcesFor = (relations: typeof graph.mergeSources) => relations
    .flatMap((relation) => {
      const source = interactionById.get(relation.sourceInteractionId);
      return source ? [{ relation, source }] : [];
    })
    .sort((left, right) => left.relation.ordinal - right.relation.ordinal);
  const headIds = new Set(graph.branches.flatMap((branch) =>
    branch.headInteractionId ? [branch.headInteractionId] : []));
  const draftForkSources = new Set(graph.branches.flatMap((branch) =>
    branch.kind === 'fork' && branch.conversationState === 'draft' && branch.forkedFromInteractionId
      && branch.creationMode === 'composer'
      ? [branch.forkedFromInteractionId]
      : []));
  const pendingByBranch = new Map(
    graph.pendingSends.map((operation) => [operation.branchId, operation]),
  );
  const sizeFor = (nodeId: string): CanvasNodeSize | undefined => {
    if (sizes[nodeId]) return sizes[nodeId];
    const saved = graph.layout?.nodes[nodeId];
    return saved?.width !== undefined && saved.height !== undefined
      ? { width: saved.width, height: saved.height }
      : undefined;
  };

  const interactionNodes: CanvasFlowNode[] = graph.interactions.map((interaction) => {
    const sourceComposerId = composerNodeId(
      interaction.branchId,
      interaction.parentInteractionId,
    );
    const size = sizeFor(interaction.id)
      || (headIds.has(interaction.id) ? sizeFor(sourceComposerId) : undefined);
    return {
      id: interaction.id,
      type: 'interaction',
      position: positions[interaction.id]
        || graph.layout?.nodes[interaction.id]
        || (headIds.has(interaction.id)
          ? positions[sourceComposerId] || graph.layout?.nodes[sourceComposerId]
          : undefined)
        || { x: 0, y: 0 },
      width: size?.width || INTERACTION_NODE_WIDTH,
      ...(size ? { height: size.height } : {}),
      dragHandle: '.canvas-node-drag-handle',
      data: {
        interaction,
        preview: previews[interaction.id] || '',
        composerOpen: draftForkSources.has(interaction.id),
        canAdd:
          !headIds.has(interaction.id)
          && interaction.executionState === 'completed'
          && !draftForkSources.has(interaction.id),
        resubmitting: input.resubmittingInteractionIds.has(interaction.id),
        resizeEnabled: input.resizeEnabled,
        onAdd: input.onAdd,
        onResubmit: input.onResubmit,
        onApprovalChanged: input.onApprovalChanged,
        mergeSources: mergeSourcesFor(mergeSources.filter((source) =>
          source.targetInteractionId === interaction.id)),
        onNavigateMergeSource: input.onNavigateMergeSource,
        onOpenMergeTargets: input.onOpenMergeTargets,
      },
    };
  });
  const interactionNodeById = new Map(interactionNodes.map((node) => [node.id, node]));
  const edges: Edge[] = graph.interactions.flatMap((interaction) =>
    interaction.parentInteractionId
      ? [{
        id: `edge-${interaction.parentInteractionId}-${interaction.id}`,
        source: interaction.parentInteractionId,
        target: interaction.id,
      }]
      : []);
  const composerNodes: CanvasFlowNode[] = [];

  for (const branch of graph.branches) {
    const isInitialDraft = branch.conversationState === 'draft';
    const head = branch.headInteractionId ? interactionById.get(branch.headInteractionId) : undefined;
    const isContinue = branch.conversationState === 'active' && head?.executionState === 'completed';
    if (!isInitialDraft && !isContinue) continue;
    const source = composerIncomingInteractionId(branch);
    const nodeId = composerNodeId(branch.id, source);
    const composerSize = sizeFor(nodeId);
    if (source) {
      edges.push({
        id: `edge-${source}-${nodeId}`,
        source,
        target: nodeId,
      });
    }
    const sourceNode = source ? interactionNodeById.get(source) : undefined;
    const occupied = [...interactionNodes, ...composerNodes]
      .map((node) => canvasNodeBounds(node, renderedById.get(node.id)));
    const defaultPosition = sourceNode
      ? placeNodeToRight(canvasNodeBounds(sourceNode, renderedById.get(sourceNode.id)), occupied, {
        width: composerSize?.width || COMPOSER_NODE_WIDTH,
        height: composerSize?.height
          || renderedById.get(nodeId)?.measured?.height
          || DEFAULT_NODE_HEIGHT,
      })
      : placeRootNode(occupied, {
        width: composerSize?.width || COMPOSER_NODE_WIDTH,
        height: composerSize?.height || DEFAULT_NODE_HEIGHT,
      });
    const pendingOperation = pendingByBranch.get(branch.id);
    const composerMergeSources = mergeSourcesFor(mergeSources.filter((relation) =>
      relation.targetInteractionId === null
      && relation.targetBranchId === branch.id
      && relation.expectedHeadInteractionId === source));
    const projectedDraft = drafts[branch.id]
      || (pendingOperation
        ? {
          ...EMPTY_CANVAS_DRAFT,
          text: pendingOperation.userInput,
          inputDocument: {
            version: 1 as const,
            segments: pendingOperation.inputDocument?.segments
              || (pendingOperation.userInput
                ? [{ type: 'text' as const, text: pendingOperation.userInput }]
                : []),
            references: (pendingOperation.inputDocument?.references || []).map((reference) => ({
              ...reference,
              name: pendingOperation.resourceReferences?.find((item) => item.key === reference.key)?.name,
              mimeType: pendingOperation.resourceReferences?.find((item) => item.key === reference.key)?.mimeType,
            })),
          },
          persistedAttachments: pendingOperation.attachments,
        }
        : EMPTY_CANVAS_DRAFT);
    composerNodes.push({
      id: nodeId,
      type: 'composer',
      position: positions[nodeId] || graph.layout?.nodes[nodeId] || defaultPosition,
      width: composerSize?.width || COMPOSER_NODE_WIDTH,
      ...(composerSize ? { height: composerSize.height } : {}),
      dragHandle: '.canvas-node-drag-handle',
      data: {
        branch,
        draft: pendingOperation
          ? { ...projectedDraft, sending: true }
          : projectedDraft,
        label: branch.kind === 'fork' && branch.conversationState === 'draft'
          ? labels.createBranch
          : branch.conversationState === 'draft'
            ? labels.newSession
            : labels.continueBranch,
        resizeEnabled: input.resizeEnabled,
        onDocumentChange: (value) => input.onDocumentChange(branch.id, value),
        onFiles: (files) => input.onFiles(branch.id, files),
        onRemoveFile: (index) => input.onRemoveFile(branch.id, index),
        onRemovePersistedAttachment: (index) =>
          input.onRemovePersistedAttachment(branch.id, index),
        onSend: () => input.onSend(branch),
        onFocus: () => input.onFocus(branch.id, source),
        onBlur: () => input.onBlur(branch.id),
        mergeSources: composerMergeSources,
        resourceScopeRevision: composerMergeSources.map(({ relation }) => relation.id).join('|'),
        onNavigateMergeSource: input.onNavigateMergeSource,
      },
    });
  }
  const all = [...interactionNodes, ...composerNodes];
  const visibleIds = new Set(all.map((node) => node.id));
  for (const relation of mergeSources) {
    const acceptedTarget = Boolean(relation.targetInteractionId);
    const target = relation.targetInteractionId
      || composerNodeId(relation.targetBranchId, relation.expectedHeadInteractionId);
    if (!visibleIds.has(relation.sourceInteractionId) || !visibleIds.has(target)) continue;
    edges.push({
      id: `merge-edge-${relation.id}`,
      source: relation.sourceInteractionId,
      sourceHandle: MERGE_SOURCE_HANDLE_ID,
      target,
      // The merge target handle only exists while the Composer is visible. Once the
      // send is accepted, the Composer is replaced by an Interaction whose ordinary
      // target handle owns all incoming history and merge edges.
      targetHandle: acceptedTarget ? undefined : MERGE_TARGET_HANDLE_ID,
      ariaLabel: labels.mergeSourceLabel(relation.ordinal + 1),
      style: { strokeWidth: 2 },
      className: 'canvas-merge-edge',
      deletable: false,
      reconnectable: false,
    });
  }
  const hasSavedLayout = Boolean(
    Object.keys(positions).length
    || (graph.layout && Object.keys(graph.layout.nodes).length),
  );
  return {
    nodes: hasSavedLayout ? all : autoLayoutCanvasNodes(all, edges),
    edges,
  };
}
