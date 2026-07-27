export type BranchKind = 'root' | 'fork';
export type BranchSessionState = 'draft' | 'active';
export type InteractionStatus = 'streaming' | 'completed' | 'failed';
export type InteractionExecutionState = 'running' | 'completed' | 'failed' | 'unconfirmed';
export type ArtifactSyncState = 'not_started' | 'observing' | 'synced' | 'degraded';

export interface CanvasSummary {
  id: string;
  name: string;
  agentId: string;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasBranch {
  id: string;
  canvasId: string;
  kind: BranchKind;
  parentBranchId: string | null;
  forkedFromInteractionId: string | null;
  sessionKey: string;
  openClawSessionId: string | null;
  observedSessionId: string | null;
  sessionIntegrity: 'unknown' | 'healthy' | 'drifted';
  sessionState: BranchSessionState;
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
  storage: 'canvas';
  available: true;
  warning?: string;
}

export interface CanvasArtifact {
  id?: string;
  gatewayArtifactId?: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  uri: string;
  storage?: 'canvas' | 'external' | 'source';
  available?: boolean;
  warning?: string;
}

export interface CanvasContextResource {
  id: string;
  sourceInteractionId: string;
  source: 'user_attachment' | 'agent_artifact';
  name: string;
  mimeType: string;
  sizeBytes?: number;
  uri: string;
  available: boolean;
  warning?: string;
  fetchUrl?: string;
}

export interface CanvasInteraction {
  id: string;
  version: number;
  branchId: string;
  parentInteractionId: string | null;
  runId: string | null;
  userInput: string;
  agentOutput: string;
  status: InteractionStatus;
  executionState: InteractionExecutionState;
  artifactSyncState: ArtifactSyncState;
  terminalAt: number | null;
  error: string | null;
  attachments: CanvasAttachmentMeta[];
  artifacts: CanvasArtifact[];
  sessionMetadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasLayout {
  nodes: Record<string, { x: number; y: number }>;
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
  sessionKey: string;
  outgoingMessage: string;
  snapshotVersion?: number;
  bootstrapResources: CanvasContextResource[];
  status: 'prepared' | 'acknowledged' | 'failed';
  dispatchState: 'reserved' | 'awaiting_media' | 'dispatching' | 'ambiguous' | 'acknowledged' | 'failed';
  attemptCount: number;
  lastAttemptAt: number | null;
  nextAttemptAt: number | null;
  error: string | null;
  interactionId: string | null;
}

export interface CanvasDraft {
  text: string;
  files: File[];
  previews: Record<string, string>;
  sending: boolean;
  error: string | null;
}
