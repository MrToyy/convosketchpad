import type { Node } from '@xyflow/react';
import {
  COMPOSER_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  INTERACTION_NODE_WIDTH,
  type CanvasNodeBounds,
} from './layout';
import type {
  CanvasBranch,
  CanvasDraft,
  CanvasDraftInputDocument,
  CanvasInteraction,
  AgentCatalogEntry,
  AgentRef,
} from './types';

export const MERGE_SOURCE_HANDLE_ID = 'merge-source';
export const MERGE_TARGET_HANDLE_ID = 'merge-target';

export function composerIncomingInteractionId(branch: CanvasBranch): string | null {
  return branch.conversationState === 'draft'
    ? branch.forkedFromInteractionId
    : branch.headInteractionId;
}

export function isComposerIncomingInteraction(
  branch: CanvasBranch,
  interactionId: string | null | undefined,
): boolean {
  return Boolean(interactionId && composerIncomingInteractionId(branch) === interactionId);
}

export interface InteractionNodeData extends Record<string, unknown> {
  interaction: CanvasInteraction;
  preview: string;
  composerOpen: boolean;
  canAdd: boolean;
  copying: boolean;
  resizeEnabled: boolean;
  onAdd: (interaction: CanvasInteraction) => void;
  onCopy: (interaction: CanvasInteraction) => void;
  onApprovalChanged: () => void;
  onOpenMergeTargets: (interaction: CanvasInteraction) => void;
}

export interface ComposerNodeData extends Record<string, unknown> {
  branch: CanvasBranch;
  draft: CanvasDraft;
  label: string;
  agents: AgentCatalogEntry[];
  onAgentChange: (agentRef: AgentRef) => void;
  resizeEnabled: boolean;
  onDocumentChange: (value: CanvasDraftInputDocument) => void;
  onFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  onRemovePersistedAttachment: (index: number) => void;
  onSend: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onClose?: () => void;
  resourceScopeRevision: string;
}

export type InteractionFlowNode = Node<InteractionNodeData, 'interaction'>;
export type ComposerFlowNode = Node<ComposerNodeData, 'composer'>;
export type CanvasFlowNode = InteractionFlowNode | ComposerFlowNode;

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
