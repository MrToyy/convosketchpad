import type {
  AgentProfileRef,
  ApprovalChoice,
  ApprovalPermission,
  ApprovalResolution,
  ApprovalSummary,
  RuntimeEvent,
  RuntimeHandle,
} from '../agent-runtimes/contract.js';
import type {
  CanvasContextResource,
  SendDispatchState,
  SendMaterialization,
} from './domain/send-policy.js';

export type BranchKind = 'root' | 'fork';
export type BranchConversationState = 'draft' | 'active';
export type BranchCreationMode = 'composer' | 'direct-submit';
export type InteractionStatus = 'streaming' | 'completed' | 'failed';
export type InteractionExecutionState = 'running' | 'completed' | 'failed' | 'unconfirmed';
export type ArtifactSyncState = 'not_started' | 'observing' | 'synced' | 'degraded';
export type BranchConversationIntegrity = 'unknown' | 'healthy' | 'drifted';
export type CanvasUserStatus = 'active' | 'disabled' | 'unmanaged';
export type { CanvasContextResource, SendDispatchState, SendMaterialization } from './domain/send-policy.js';

export interface CanvasUserRecord {
  id: string;
  displayName: string;
  tokenHash: string | null;
  tokenVersion: number;
  status: CanvasUserStatus;
  canvasCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasRecord {
  id: string;
  name: string;
  agentRef: AgentProfileRef;
  agentMutable: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface BranchRecord {
  id: string;
  canvasId: string;
  kind: BranchKind;
  parentBranchId: string | null;
  forkedFromInteractionId: string | null;
  conversationId: string;
  conversationInstanceId: string | null;
  observedConversationInstanceId: string | null;
  conversationIntegrity: BranchConversationIntegrity;
  conversationState: BranchConversationState;
  creationMode: BranchCreationMode;
  headInteractionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface InteractionContextSnapshot {
  usedTokens: number;
  contextLimit: number;
  conversationInstanceId: string;
  model?: string;
  provider?: string;
  compactionCount?: number;
  capturedAt: number;
  source: 'agent-runtime';
  runtimeId: string;
  conversationRef?: RuntimeHandle;
}

export interface InteractionRecord {
  id: string;
  version: number;
  branchId: string;
  parentInteractionId: string | null;
  runtimeTurnId: string | null;
  turnRef?: RuntimeHandle | null;
  userInput: string;
  agentOutput: string;
  status: InteractionStatus;
  executionState: InteractionExecutionState;
  artifactSyncState: ArtifactSyncState;
  terminalAt: number | null;
  error: string | null;
  attachments: CanvasAttachment[];
  artifacts: CanvasArtifact[];
  approvals: InteractionApprovalRecord[];
  executionMetadata: Record<string, unknown>;
  contextSnapshot: InteractionContextSnapshot | null;
  createdAt: number;
  updatedAt: number;
}

export type InteractionApprovalStatus =
  | 'pending'
  | 'resolving'
  | 'resolved'
  | 'denied'
  | 'expired'
  | 'unconfirmed';

export interface InteractionApprovalRecord {
  id: string;
  interactionId: string;
  runtimeId: string;
  approvalRef: RuntimeHandle;
  category: ApprovalSummary['category'];
  title: string;
  description?: string;
  risk: ApprovalSummary['risk'];
  permissions: ApprovalPermission[];
  choices: ApprovalChoice[];
  expiresAt: number | null;
  status: InteractionApprovalStatus;
  resolution: ApprovalResolution | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface OwnedInteractionApprovalResolution {
  approval: InteractionApprovalRecord;
  ownerId: string;
  canvasId: string;
}

export interface OwnedInteractionRecord extends InteractionRecord {
  ownerId: string;
  canvasId: string;
  conversationId: string;
  runtimeId: string;
  agentProfileId: string;
  conversationRef?: RuntimeHandle;
  conversationInstanceId: string | null;
  observedConversationInstanceId: string | null;
  conversationIntegrity: BranchConversationIntegrity;
}

export interface CanvasAttachment {
  id?: string;
  contentHash?: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uri?: string;
  thumbnailUri?: string;
  sourceUri?: string;
  storage?: 'canvas' | 'source';
  available?: boolean;
  warning?: string;
}

export interface CanvasArtifact {
  id?: string;
  contentHash?: string;
  runtimeArtifactId?: string;
  runtimeArtifactRef?: RuntimeHandle;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  uri: string;
  thumbnailUri?: string;
  sourceUri?: string;
  storage?: 'canvas' | 'external' | 'source';
  available?: boolean;
  warning?: string;
}

export interface CanvasGraph {
  cursor: number;
  canvas: CanvasRecord;
  branches: BranchRecord[];
  interactions: InteractionRecord[];
  layout: {
    nodes: Record<string, {
      x: number;
      y: number;
      width?: number;
      height?: number;
    }>;
    viewport?: { x: number; y: number; zoom: number };
  } | null;
  pendingSends: SendReservation[];
  failedSends: SendReservation[];
}

export interface CanvasSyncBatch {
  cursor: number;
  canvas?: CanvasRecord;
  branches: BranchRecord[];
  interactions: InteractionRecord[];
  sendOperations: SendReservation[];
  removed: {
    branchIds: string[];
    interactionIds: string[];
    sendOperationIds: string[];
  };
}

export interface StoredRuntimeEvent {
  eventKey: string;
  runtimeId: string;
  conversationRef: RuntimeHandle | null;
  turnRef: RuntimeHandle | null;
  event: RuntimeEvent;
  createdAt: number;
}

export interface SendReservation {
  id: string;
  branchId: string;
  expectedHeadInteractionId: string | null;
  userInput: string;
  attachments: CanvasAttachment[];
  materialization: SendMaterialization;
  conversationId: string;
  runtimeId: string;
  conversationRef?: RuntimeHandle;
  dispatchRecoveryRef?: RuntimeHandle | null;
  outgoingMessage: string;
  snapshotVersion?: number;
  bootstrapResources: CanvasContextResource[];
  status: 'prepared' | 'acknowledged' | 'failed';
  dispatchState: SendDispatchState;
  attemptCount: number;
  lastAttemptAt: number | null;
  nextAttemptAt: number | null;
  error: string | null;
  interactionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DispatchableSendReservation extends SendReservation {
  ownerId: string;
  canvasId: string;
  agentProfileId: string;
}

export type CanvasMediaDerivativePurpose = 'delivery' | 'thumbnail';

export interface CanvasMediaDerivative {
  canvasId: string;
  sourceContentHash: string;
  purpose: CanvasMediaDerivativePurpose;
  policyVersion: string;
  derivativeId: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasMediaBackfillSource {
  kind: 'attachment' | 'artifact';
  ownerId: string;
  canvasId: string;
  interactionId?: string;
  sourceId: string;
  name: string;
  mimeType: string;
  contentHash?: string;
}

export interface BranchConversationLifecycle {
  conversationStartedAt: number | null;
  observedConversationStartedAt: number | null;
  lastInteractionAt: number | null;
}

export interface BranchRuntimeContext {
  runtimeId: string;
  agentProfileId: string;
  conversationRef: RuntimeHandle;
  observedConversationRef: RuntimeHandle | null;
  conversationStartedAt: number | null;
  observedConversationStartedAt: number | null;
  lastInteractionAt: number | null;
}
