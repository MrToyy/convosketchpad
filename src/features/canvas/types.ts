export type BranchKind = 'root' | 'fork';
export type BranchConversationState = 'draft' | 'active';
export type BranchCreationMode = 'composer' | 'direct-submit';
export type InteractionStatus = 'streaming' | 'completed' | 'failed';
export type InteractionExecutionState = 'running' | 'completed' | 'failed' | 'unconfirmed';
export type ArtifactSyncState = 'not_started' | 'observing' | 'synced' | 'degraded';

export interface AgentRef {
  backendId: string;
  profileId: string;
}

export interface AgentCatalogEntry {
  agentRef: AgentRef;
  displayName: string;
  backendDisplayName: string;
  available: boolean;
  unavailableReason?: string;
}

export interface CanvasSummary {
  id: string;
  name: string;
  agentRef: AgentRef;
  agentMutable: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasBranch {
  id: string;
  canvasId: string;
  kind: BranchKind;
  parentBranchId: string | null;
  forkedFromInteractionId: string | null;
  conversationId: string;
  conversationInstanceId: string | null;
  observedConversationInstanceId: string | null;
  conversationIntegrity: 'unknown' | 'healthy' | 'drifted';
  conversationState: BranchConversationState;
  creationMode: BranchCreationMode;
  headInteractionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasAttachmentMeta {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uri: string;
  thumbnailUri?: string;
  storage: 'canvas';
  available: true;
  warning?: string;
}

export interface CanvasArtifact {
  id?: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  uri: string;
  thumbnailUri?: string;
  storage?: 'canvas' | 'external' | 'source';
  available?: boolean;
  warning?: string;
}

export interface InteractionContextSnapshot {
  usedTokens: number;
  contextLimit: number;
  backendId: string;
  conversationInstanceId: string;
  model?: string;
  provider?: string;
  compactionCount?: number;
  capturedAt: number;
  source: 'agent-backend';
}

export interface InteractionApproval {
  id: string;
  category: 'command' | 'plugin' | 'network' | 'filesystem' | 'other';
  title: string;
  description?: string;
  risk: 'low' | 'medium' | 'high';
  permissions: Array<{ id: string; label: string; description?: string; risk?: 'low' | 'medium' | 'high' }>;
  choices: Array<{
    id: string;
    intent: 'grant' | 'deny';
    scope: 'item' | 'turn' | 'session' | 'persistent';
    label: string;
    requiresConfirmation: boolean;
  }>;
  expiresAt: number | null;
  status: 'pending' | 'resolving' | 'resolved' | 'denied' | 'expired' | 'unconfirmed';
  resolution: { choiceId: string; grantedPermissionIds?: string[] } | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasInteraction {
  id: string;
  version: number;
  branchId: string;
  parentInteractionId: string | null;
  userInput: string;
  agentOutput: string;
  status: InteractionStatus;
  executionState: InteractionExecutionState;
  artifactSyncState: ArtifactSyncState;
  terminalAt: number | null;
  error: string | null;
  attachments: CanvasAttachmentMeta[];
  artifacts: CanvasArtifact[];
  approvals: InteractionApproval[];
  executionMetadata: Record<string, unknown>;
  contextSnapshot: InteractionContextSnapshot | null;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasLayoutNode {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface CanvasLayout {
  nodes: Record<string, CanvasLayoutNode>;
  viewport?: { x: number; y: number; zoom: number };
}

export interface CanvasGraph {
  cursor: number;
  canvas: CanvasSummary;
  hasPendingUpdates: boolean;
  branches: CanvasBranch[];
  interactions: CanvasInteraction[];
  layout: CanvasLayout | null;
  pendingSends: SendReservation[];
  failedSends: SendReservation[];
}

export interface CanvasSyncBatch {
  cursor: number;
  canvas?: CanvasSummary;
  branches: CanvasBranch[];
  interactions: CanvasInteraction[];
  sendOperations: SendReservation[];
  removed: {
    branchIds: string[];
    interactionIds: string[];
    sendOperationIds: string[];
  };
}

export interface SendReservation {
  id: string;
  branchId: string;
  expectedHeadInteractionId: string | null;
  userInput: string;
  attachments: CanvasAttachmentMeta[];
  materialization: 'lazy-root' | 'continue-existing' | 'checkpoint-delta' | 'canonical-replay' | 'session-recovery';
  conversationId: string;
  snapshotVersion?: number;
  status: 'prepared' | 'acknowledged' | 'failed';
  dispatchState: 'reserved' | 'awaiting_media' | 'dispatching' | 'ambiguous' | 'acknowledged' | 'failed';
  attemptCount: number;
  lastAttemptAt: number | null;
  nextAttemptAt: number | null;
  error: string | null;
  interactionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasDraft {
  text: string;
  files: File[];
  persistedAttachments: CanvasAttachmentMeta[];
  previews: Record<string, string>;
  sending: boolean;
  error: string | null;
}
