/** Protocol-neutral contract between Canvas orchestration and an Agent runtime. */

export interface OwnerContext {
  ownerId: string;
}

export interface BackendHandle {
  backendId: string;
  schemaVersion: number;
  opaque: Record<string, string>;
}

export type ConversationHandle = BackendHandle;
export type TurnHandle = BackendHandle;
export type BackendArtifactHandle = BackendHandle;
export type ApprovalHandle = BackendHandle;

export interface AgentProfileRef {
  backendId: string;
  profileId: string;
}

export interface AgentProfile extends AgentProfileRef {
  displayName: string;
  backendProfileRef: BackendHandle;
  metadata?: Record<string, unknown>;
}

export interface BackendDescriptor {
  id: string;
  displayName: string;
  version?: string;
}

export interface BackendCapabilities {
  conversation: { resume: boolean; readHistory: boolean; nativeFork: boolean };
  input: { text: boolean; images: boolean; audio: boolean; arbitraryFiles: boolean };
  output: { textStreaming: boolean; imageGeneration: boolean; artifacts: boolean };
  execution: { interrupt: boolean; steer: boolean; interactiveApprovals: boolean };
  reliability: { idempotentDispatch: boolean; inspectAfterUnknownOutcome: boolean };
  usage: { turnTokens: boolean; contextWindow: boolean; accountUsage: boolean; accountQuota: boolean };
}

export interface BackendStatus {
  backendId: string;
  state: 'disconnected' | 'connecting' | 'connected';
  error?: string;
  version?: string;
  maxPayload?: number;
  restartSupported?: boolean;
  capabilities?: BackendCapabilities;
  diagnostics?: Record<string, unknown>;
}

export type BackendErrorKind =
  | 'validation'
  | 'unsupported'
  | 'unavailable'
  | 'unauthorized'
  | 'rejected'
  | 'conflict'
  | 'timeout'
  | 'unknown_outcome'
  | 'internal';

export class BackendOperationError extends Error {
  readonly kind: BackendErrorKind;
  override readonly cause?: unknown;

  constructor(
    kind: BackendErrorKind,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'BackendOperationError';
    this.kind = kind;
    this.cause = cause;
  }
}

export interface BackendInputAttachment {
  name?: string;
  fileName?: string;
  mimeType: string;
  content: string;
}

export interface DispatchTurnInput {
  profile: AgentProfileRef;
  conversationRef: ConversationHandle;
  message: string;
  attachments: BackendInputAttachment[];
  idempotencyKey: string;
  timeoutMs?: number;
}

export type DispatchResult =
  | { outcome: 'accepted'; turnRef: TurnHandle | null }
  | { outcome: 'rejected'; error: BackendOperationError }
  | { outcome: 'unknown'; error: BackendOperationError; recoveryRef?: BackendHandle };

export interface ConversationSnapshot {
  exists: boolean;
  conversationRef: ConversationHandle;
  instanceId?: string;
  startedAt?: number;
  context?: {
    usedTokens: number;
    contextLimit: number;
    model?: string;
    provider?: string;
    compactionCount?: number;
  };
  backendMetadata?: Record<string, unknown>;
}

export type ApprovalRisk = 'low' | 'medium' | 'high';
export type ApprovalScope = 'item' | 'turn' | 'session' | 'persistent';

export interface ApprovalPermission {
  id: string;
  label: string;
  description?: string;
  risk?: ApprovalRisk;
}

export interface ApprovalChoice {
  id: string;
  intent: 'grant' | 'deny';
  scope: ApprovalScope;
  label: string;
  requiresConfirmation: boolean;
}

export interface ApprovalSummary {
  category: 'command' | 'plugin' | 'network' | 'filesystem' | 'other';
  title: string;
  description?: string;
  risk: ApprovalRisk;
  permissions: ApprovalPermission[];
  choices: ApprovalChoice[];
  expiresAt?: number;
}

export interface ApprovalResolution {
  choiceId: string;
  grantedPermissionIds?: string[];
}

export type ApprovalResolutionResult =
  | { outcome: 'accepted'; resolution: ApprovalResolution }
  | { outcome: 'rejected'; error: BackendOperationError }
  | { outcome: 'unknown'; error: BackendOperationError };

interface BackendEventBase {
  backendId: string;
  eventId?: string;
  sequence?: number;
  conversationRef?: ConversationHandle;
  turnRef?: TurnHandle;
  createdAt: number;
}

export type BackendEvent = BackendEventBase & (
  | { type: 'turn.accepted' }
  | { type: 'output.text.delta'; text: string }
  | { type: 'output.message.completed'; text: string }
  | { type: 'artifact.available'; artifactRef: BackendArtifactHandle; name: string; mimeType?: string }
  | { type: 'usage.updated'; usedTokens?: number; contextLimit?: number }
  | { type: 'approval.required'; approvalRef: ApprovalHandle; approval: ApprovalSummary }
  | { type: 'approval.resolved'; approvalRef: ApprovalHandle; resolution: ApprovalResolution; resolvedBy?: string }
  | { type: 'input.required'; prompt?: string }
  | { type: 'turn.completed'; text?: string }
  | { type: 'turn.failed'; error: string }
  | { type: 'turn.interrupted'; error?: string }
  | { type: 'backend.disconnected'; error?: string }
);

export interface BackendUsageSummary {
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  updatedAt: number;
  source: string;
  currency?: string;
  period?: 'all-time' | 'billing-cycle' | 'rolling' | 'unknown';
  additive?: boolean;
}

export interface BackendProviderQuotaWindow {
  label: string;
  usedPercent: number;
  resetAt: number | null;
}

export interface BackendProviderQuota {
  provider: string;
  displayName: string;
  plan: string | null;
  windows: BackendProviderQuotaWindow[];
}

export interface MaterializedArtifact {
  bytes?: Uint8Array;
  mimeType?: string;
  externalUrl?: string;
}

export interface BackendArtifactCandidate {
  id?: string;
  backendArtifactRef?: BackendArtifactHandle;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  uri: string;
  sourceUri?: string;
  storage?: 'external' | 'source';
  available?: boolean;
  warning?: string;
}

export interface ReadTurnInput {
  profile: AgentProfileRef;
  conversationRef: ConversationHandle;
  turnRef: TurnHandle | null;
  userInput: string;
  createdAt: number;
}

export interface BackendTurnSnapshot {
  agentOutput: string;
  artifacts: BackendArtifactCandidate[];
  matchedTurn: boolean;
  instanceId?: string;
  artifactDiscoveryComplete: boolean;
  artifactWarnings: string[];
}

export interface BackendTurnStatus {
  found: boolean;
  terminal: boolean;
  reflectsTurn: boolean;
  terminalAt?: number;
  failure?: string;
  instanceId?: string;
}

export interface AgentBackend {
  readonly id: string;
  describe(): Promise<BackendDescriptor>;
  listAgentProfiles(owner: OwnerContext): Promise<{ defaultProfileId?: string; profiles: AgentProfile[] }>;
  getCapabilities(profile: AgentProfileRef): Promise<BackendCapabilities>;
  inspectConversation(handle: ConversationHandle): Promise<ConversationSnapshot | null>;
  conversationWillExpireBeforeNextTurn(handle: ConversationHandle, input: {
    conversationStartedAt: number | null;
    lastInteractionAt: number | null;
  }): Promise<boolean>;
  createConversationHandle(input: {
    profile: AgentProfileRef;
    localConversationId: string;
  }): ConversationHandle;
  dispatchTurn(input: DispatchTurnInput): Promise<DispatchResult>;
  readTurn(input: ReadTurnInput): Promise<BackendTurnSnapshot>;
  inspectTurn(input: ReadTurnInput): Promise<BackendTurnStatus>;
  resolveApproval(input: {
    approvalRef: ApprovalHandle;
    resolution: ApprovalResolution;
  }): Promise<ApprovalResolutionResult>;
  materializeArtifact(handle: BackendArtifactHandle): Promise<MaterializedArtifact>;
  createArtifactHandle(input: {
    sourceUri: string;
    profile: AgentProfileRef;
    conversationRef: ConversationHandle;
    mimeType?: string;
  }): BackendArtifactHandle;
  readUsageSummary(): Promise<BackendUsageSummary>;
  readProviderQuotas(): Promise<{ available: boolean; providers: BackendProviderQuota[] }>;
  restart(): Promise<{ output: string }>;
  getStatus(): BackendStatus;
  subscribeEvents(listener: (event: BackendEvent) => void): () => void;
  subscribeStatus(listener: (status: BackendStatus) => void): () => void;
  close(): void;
}

export function backendHandle(
  backendId: string,
  opaque: Record<string, string>,
  schemaVersion = 1,
): BackendHandle {
  return { backendId, schemaVersion, opaque };
}

export function assertBackendHandle(handle: BackendHandle, backendId: string): void {
  if (handle.backendId !== backendId) {
    throw new BackendOperationError('validation', `Handle belongs to ${handle.backendId}, not ${backendId}`);
  }
  if (handle.schemaVersion !== 1) {
    throw new BackendOperationError('unsupported', `Unsupported ${backendId} handle schema ${handle.schemaVersion}`);
  }
}
