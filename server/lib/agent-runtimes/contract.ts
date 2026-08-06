/** Protocol-neutral contract between Canvas orchestration and an Agent runtime. */

export interface OwnerContext {
  ownerId: string;
}

export interface RuntimeHandle {
  runtimeId: string;
  schemaVersion: number;
  opaque: Record<string, string>;
}

export type ConversationHandle = RuntimeHandle;
export type TurnHandle = RuntimeHandle;
export type RuntimeArtifactHandle = RuntimeHandle;
export type ApprovalHandle = RuntimeHandle;

export interface AgentProfileRef {
  runtimeId: string;
  profileId: string;
}

export interface AgentProfile extends AgentProfileRef {
  displayName: string;
  runtimeProfileRef: RuntimeHandle;
  metadata?: Record<string, unknown>;
}

export interface RuntimeDescriptor {
  id: string;
  displayName: string;
  version?: string;
}

export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown';

export interface RuntimeCapabilities {
  conversation: { resume: boolean; readHistory: boolean; nativeFork: boolean };
  input: { text: boolean; images: boolean; audio: boolean; arbitraryFiles: boolean };
  output: { textStreaming: boolean; imageGeneration: CapabilitySupport; artifacts: boolean };
  execution: { interrupt: boolean; steer: boolean; interactiveApprovals: boolean };
  reliability: { idempotentDispatch: boolean; inspectAfterUnknownOutcome: boolean };
  usage: { turnTokens: boolean; contextWindow: boolean; accountUsage: boolean; accountQuota: boolean };
}

export interface RuntimeStatus {
  runtimeId: string;
  state: 'disconnected' | 'connecting' | 'connected';
  error?: string;
  version?: string;
  maxPayload?: number;
  restartSupported?: boolean;
  capabilities?: RuntimeCapabilities;
  diagnostics?: Record<string, unknown>;
}

export type RuntimeErrorKind =
  | 'validation'
  | 'unsupported'
  | 'unavailable'
  | 'unauthorized'
  | 'rejected'
  | 'conflict'
  | 'timeout'
  | 'unknown_outcome'
  | 'internal';

export class RuntimeOperationError extends Error {
  readonly kind: RuntimeErrorKind;
  override readonly cause?: unknown;

  constructor(
    kind: RuntimeErrorKind,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'RuntimeOperationError';
    this.kind = kind;
    this.cause = cause;
  }
}

export interface RuntimeInputAttachment {
  name?: string;
  fileName?: string;
  mimeType: string;
  content: string;
}

export interface DispatchTurnInput {
  profile: AgentProfileRef;
  conversationRef: ConversationHandle;
  message: string;
  attachments: RuntimeInputAttachment[];
  idempotencyKey: string;
  timeoutMs?: number;
}

export type DispatchResult =
  | { outcome: 'accepted'; turnRef: TurnHandle | null; conversationRef?: ConversationHandle; conversationInstanceId?: string }
  | { outcome: 'rejected'; error: RuntimeOperationError }
  | { outcome: 'unknown'; error: RuntimeOperationError; recoveryRef?: RuntimeHandle };

export interface ReconcileDispatchInput {
  profile: AgentProfileRef;
  conversationRef: ConversationHandle;
  recoveryRef: RuntimeHandle | null;
  idempotencyKey: string;
  message: string;
  createdAt: number;
}

export type ReconcileDispatchResult =
  | { outcome: 'accepted'; turnRef: TurnHandle | null; conversationRef?: ConversationHandle; conversationInstanceId?: string }
  | { outcome: 'not_found' }
  | { outcome: 'unknown'; error: RuntimeOperationError; recoveryRef?: RuntimeHandle };

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
  runtimeMetadata?: Record<string, unknown>;
}

export type ConversationPreparation =
  | { outcome: 'continued' }
  | { outcome: 'recreated'; reason: string };

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
  | { outcome: 'rejected'; error: RuntimeOperationError }
  | { outcome: 'unknown'; error: RuntimeOperationError };

interface RuntimeEventBase {
  runtimeId: string;
  eventId?: string;
  sequence?: number;
  conversationRef?: ConversationHandle;
  turnRef?: TurnHandle;
  createdAt: number;
}

export type RuntimeEvent = RuntimeEventBase & (
  | { type: 'turn.accepted' }
  | { type: 'output.text.delta'; text: string; messageId?: string }
  | { type: 'output.text.snapshot'; text: string; messageId?: string }
  | { type: 'output.message.completed'; text: string; messageId?: string }
  | { type: 'artifact.available'; artifactRef: RuntimeArtifactHandle; name: string; mimeType?: string }
  | { type: 'usage.updated'; usedTokens?: number; contextLimit?: number }
  | { type: 'approval.required'; approvalRef: ApprovalHandle; approval: ApprovalSummary }
  | { type: 'approval.resolved'; approvalRef: ApprovalHandle; resolution: ApprovalResolution; resolvedBy?: string }
  | { type: 'input.required'; prompt?: string }
  | { type: 'turn.completed'; text?: string }
  | { type: 'turn.failed'; error: string }
  | { type: 'turn.interrupted'; error?: string }
  | { type: 'runtime.disconnected'; error?: string }
);

export interface RuntimeUsageSummary {
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

export interface RuntimeProviderQuotaWindow {
  label: string;
  usedPercent: number;
  resetAt: number | null;
}

export interface RuntimeProviderQuota {
  provider: string;
  displayName: string;
  plan: string | null;
  windows: RuntimeProviderQuotaWindow[];
}

export interface MaterializedArtifact {
  bytes?: Uint8Array;
  mimeType?: string;
  externalUrl?: string;
}

export interface RuntimeArtifactCandidate {
  id?: string;
  runtimeArtifactRef?: RuntimeArtifactHandle;
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

export interface RuntimeTurnSnapshot {
  agentOutput: string;
  artifacts: RuntimeArtifactCandidate[];
  matchedTurn: boolean;
  instanceId?: string;
  artifactDiscoveryComplete: boolean;
  artifactWarnings: string[];
}

export interface RuntimeTurnStatus {
  found: boolean;
  terminal: boolean;
  reflectsTurn: boolean;
  terminalAt?: number;
  failure?: string;
  instanceId?: string;
}

export interface AgentRuntime {
  readonly id: string;
  describe(): Promise<RuntimeDescriptor>;
  listAgentProfiles(owner: OwnerContext): Promise<{ defaultProfileId?: string; profiles: AgentProfile[] }>;
  getCapabilities(profile: AgentProfileRef): Promise<RuntimeCapabilities>;
  inspectConversation(handle: ConversationHandle): Promise<ConversationSnapshot | null>;
  prepareConversation(handle: ConversationHandle, input: {
    conversationStartedAt: number | null;
    lastInteractionAt: number | null;
  }): Promise<ConversationPreparation>;
  createConversationHandle(input: {
    profile: AgentProfileRef;
    localConversationId: string;
  }): ConversationHandle;
  dispatchTurn(input: DispatchTurnInput): Promise<DispatchResult>;
  reconcileDispatch(input: ReconcileDispatchInput): Promise<ReconcileDispatchResult>;
  readTurn(input: ReadTurnInput): Promise<RuntimeTurnSnapshot>;
  inspectTurn(input: ReadTurnInput): Promise<RuntimeTurnStatus>;
  resolveApproval(input: {
    approvalRef: ApprovalHandle;
    resolution: ApprovalResolution;
  }): Promise<ApprovalResolutionResult>;
  materializeArtifact(handle: RuntimeArtifactHandle): Promise<MaterializedArtifact>;
  releaseArtifact?(handle: RuntimeArtifactHandle): Promise<void>;
  createArtifactHandle(input: {
    sourceUri: string;
    profile: AgentProfileRef;
    conversationRef: ConversationHandle;
    mimeType?: string;
  }): RuntimeArtifactHandle;
  readUsageSummary(): Promise<RuntimeUsageSummary>;
  readProviderQuotas(): Promise<{ available: boolean; providers: RuntimeProviderQuota[] }>;
  restart(): Promise<{ output: string }>;
  getStatus(): RuntimeStatus;
  subscribeEvents(listener: (event: RuntimeEvent) => void): () => void;
  subscribeStatus(listener: (status: RuntimeStatus) => void): () => void;
  close(): void;
}

export function runtimeHandle(
  runtimeId: string,
  opaque: Record<string, string>,
  schemaVersion = 1,
): RuntimeHandle {
  return { runtimeId, schemaVersion, opaque };
}

export function assertRuntimeHandle(handle: RuntimeHandle, runtimeId: string): void {
  if (handle.runtimeId !== runtimeId) {
    throw new RuntimeOperationError('validation', `Handle belongs to ${handle.runtimeId}, not ${runtimeId}`);
  }
  if (handle.schemaVersion !== 1) {
    throw new RuntimeOperationError('unsupported', `Unsupported ${runtimeId} handle schema ${handle.schemaVersion}`);
  }
}
