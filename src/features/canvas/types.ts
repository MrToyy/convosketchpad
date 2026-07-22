export type BranchKind = 'root' | 'fork';
export type BranchSessionState = 'draft' | 'active';
export type InteractionStatus = 'streaming' | 'completed' | 'failed';
export type AgentActivity = 'idle' | 'queued' | 'working' | 'settling' | 'completed' | 'failed' | 'unknown';

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
  sessionState: BranchSessionState;
  headInteractionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasAttachmentMeta {
  id?: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  mode?: 'inline' | 'file_reference';
  uri?: string;
  workspacePath?: string;
}

export interface CanvasArtifact {
  id?: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  uri: string;
  sourceUri?: string;
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
  branchId: string;
  parentInteractionId: string | null;
  runId: string | null;
  userInput: string;
  agentOutput: string;
  status: InteractionStatus;
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
  canvas: CanvasSummary;
  branches: CanvasBranch[];
  interactions: CanvasInteraction[];
  layout: CanvasLayout | null;
}

export interface SendReservation {
  id: string;
  branchId: string;
  expectedHeadInteractionId: string | null;
  userInput: string;
  attachments: CanvasAttachmentMeta[];
  materialization: 'lazy-root' | 'continue-existing' | 'checkpoint-delta' | 'canonical-replay';
  sessionKey: string;
  outgoingMessage: string;
  snapshotVersion?: number;
  bootstrapResources: CanvasContextResource[];
  status: 'prepared' | 'acknowledged' | 'failed';
  interactionId: string | null;
}

export interface CanvasDraft {
  text: string;
  files: File[];
  previews: Record<string, string>;
  sending: boolean;
  error: string | null;
}
