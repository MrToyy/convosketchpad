import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type BackendEvent,
  type BackendHandle,
  type AgentProfileRef,
  type ApprovalChoice,
  type ApprovalPermission,
  type ApprovalResolution,
  type ApprovalSummary,
} from './agent-backends/contract.js';
import { getAgentBackend } from './agent-backends/registry.js';
import { buildCanvasReplayPlan } from './canvas-replay-plan.js';
import {
  decideCanvasSendPlan,
  type CanonicalCanvasSnapshot,
  type CanvasContextResource,
  type SendDispatchState,
  type SendMaterialization,
} from './canvas-domain.js';
import { assembleCanonicalCanvasSnapshot } from './canvas-history-snapshot.js';
import { config } from './config.js';
import { applySingleChainSchemaMigration } from './canvas-migrations.js';
import { packageMetadata } from './package-metadata.js';
import { ensureGenericAgentBackendSchema } from './canvas-agent-backend-schema.js';

export type BranchKind = 'root' | 'fork';
export type BranchConversationState = 'draft' | 'active';
export type BranchCreationMode = 'composer' | 'direct-submit';
export type InteractionStatus = 'streaming' | 'completed' | 'failed';
export type InteractionExecutionState = 'running' | 'completed' | 'failed' | 'unconfirmed';
export type ArtifactSyncState = 'not_started' | 'observing' | 'synced' | 'degraded';
export type { CanvasContextResource, SendDispatchState, SendMaterialization } from './canvas-domain.js';
export type BranchConversationIntegrity = 'unknown' | 'healthy' | 'drifted';
export type CanvasUserStatus = 'active' | 'disabled' | 'unmanaged';

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
  source: 'agent-backend';
  backendId: string;
  conversationRef?: BackendHandle;
}

export interface InteractionRecord {
  id: string;
  version: number;
  branchId: string;
  parentInteractionId: string | null;
  backendTurnId: string | null;
  turnRef?: BackendHandle | null;
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
  backendId: string;
  approvalRef: BackendHandle;
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

export interface OwnedInteractionRecord extends InteractionRecord {
  ownerId: string;
  canvasId: string;
  conversationId: string;
  backendId: string;
  agentProfileId: string;
  conversationRef?: BackendHandle;
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
  backendArtifactId?: string;
  backendArtifactRef?: BackendHandle;
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

export interface StoredBackendEvent {
  eventKey: string;
  backendId: string;
  conversationRef: BackendHandle | null;
  turnRef: BackendHandle | null;
  event: BackendEvent;
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
  backendId: string;
  conversationRef?: BackendHandle;
  dispatchRecoveryRef?: BackendHandle | null;
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

export interface BranchBackendContext {
  backendId: string;
  agentProfileId: string;
  conversationRef: BackendHandle;
  observedConversationRef: BackendHandle | null;
  conversationStartedAt: number | null;
  observedConversationStartedAt: number | null;
  lastInteractionAt: number | null;
}

type SqlRow = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value || 0);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function parseBackendHandle(value: unknown): BackendHandle | null {
  const handle = parseJson<BackendHandle | null>(value, null);
  if (!handle || typeof handle !== 'object' || Array.isArray(handle)) return null;
  if (typeof handle.backendId !== 'string' || !handle.backendId) return null;
  if (typeof handle.schemaVersion !== 'number' || !Number.isInteger(handle.schemaVersion)) return null;
  if (!handle.opaque || typeof handle.opaque !== 'object' || Array.isArray(handle.opaque)) return null;
  if (Object.values(handle.opaque).some((entry) => typeof entry !== 'string')) return null;
  return handle;
}

function parseInteractionContextSnapshot(value: unknown): InteractionContextSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (
    typeof snapshot.usedTokens !== 'number'
    || !Number.isFinite(snapshot.usedTokens)
    || snapshot.usedTokens < 0
    || typeof snapshot.contextLimit !== 'number'
    || !Number.isFinite(snapshot.contextLimit)
    || snapshot.contextLimit <= 0
    || typeof snapshot.conversationInstanceId !== 'string'
    || !snapshot.conversationInstanceId
    || typeof snapshot.capturedAt !== 'number'
    || !Number.isFinite(snapshot.capturedAt)
    || snapshot.source !== 'agent-backend'
  ) {
    return null;
  }
  return value as InteractionContextSnapshot;
}

function mapCanvas(row: SqlRow): CanvasRecord {
  return {
    id: asString(row.id),
    name: asString(row.name),
    agentRef: {
      backendId: asString(row.backend_id),
      profileId: asString(row.agent_profile_id),
    },
    agentMutable: row.agent_locked_at == null,
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
}

function mapCanvasUser(row: SqlRow): CanvasUserRecord {
  return {
    id: asString(row.id),
    displayName: asString(row.display_name),
    tokenHash: asNullableString(row.token_hash),
    tokenVersion: Math.max(1, asNumber(row.token_version)),
    status: (asString(row.status) || 'unmanaged') as CanvasUserStatus,
    canvasCount: asNumber(row.canvas_count),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
}

function mapBranch(row: SqlRow): BranchRecord {
  return {
    id: asString(row.id),
    canvasId: asString(row.canvas_id),
    kind: asString(row.kind) as BranchKind,
    parentBranchId: asNullableString(row.parent_branch_id),
    forkedFromInteractionId: asNullableString(row.forked_from_interaction_id),
    conversationId: asString(row.conversation_id),
    conversationInstanceId: asNullableString(row.conversation_instance_id),
    observedConversationInstanceId: asNullableString(row.observed_conversation_instance_id),
    conversationIntegrity: (asString(row.conversation_integrity) || 'unknown') as BranchConversationIntegrity,
    conversationState: asString(row.conversation_state) as BranchConversationState,
    creationMode: (asString(row.creation_mode) || 'composer') as BranchCreationMode,
    headInteractionId: asNullableString(row.head_interaction_id),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
}

function mapInteraction(row: SqlRow): InteractionRecord {
  const executionMetadata = parseJson<Record<string, unknown>>(row.execution_metadata_json, {});
  const contextSnapshot = parseInteractionContextSnapshot(executionMetadata.contextSnapshot);
  const backendTurnId = asNullableString(row.backend_turn_id);
  return {
    id: asString(row.id),
    version: Math.max(1, asNumber(row.version) || 1),
    branchId: asString(row.branch_id),
    parentInteractionId: asNullableString(row.parent_interaction_id),
    backendTurnId,
    turnRef: parseBackendHandle(row.turn_ref_json),
    userInput: asString(row.user_input),
    agentOutput: asString(row.agent_output),
    status: asString(row.status) as InteractionStatus,
    executionState: (asString(row.execution_state)
      || (asString(row.status) === 'completed' ? 'completed' : asString(row.status) === 'failed' ? 'failed' : 'running')) as InteractionExecutionState,
    artifactSyncState: (asString(row.artifact_sync_state) || 'not_started') as ArtifactSyncState,
    terminalAt: row.terminal_at == null ? null : asNumber(row.terminal_at),
    error: asNullableString(row.error),
    attachments: parseJson<CanvasAttachment[]>(row.attachments_json, []),
    artifacts: parseJson<CanvasArtifact[]>(row.artifacts_json, []),
    approvals: [],
    executionMetadata,
    contextSnapshot,
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
}

function mapInteractionApproval(row: SqlRow): InteractionApprovalRecord {
  const approvalRef = parseBackendHandle(row.approval_ref_json);
  if (!approvalRef) throw new Error('Stored approval has an invalid Backend handle');
  return {
    id: asString(row.id),
    interactionId: asString(row.interaction_id),
    backendId: asString(row.backend_id),
    approvalRef,
    category: asString(row.category) as ApprovalSummary['category'],
    title: asString(row.title),
    ...(asNullableString(row.description) ? { description: asString(row.description) } : {}),
    risk: asString(row.risk) as ApprovalSummary['risk'],
    permissions: parseJson<ApprovalPermission[]>(row.permissions_json, []),
    choices: parseJson<ApprovalChoice[]>(row.choices_json, []),
    expiresAt: row.expires_at == null ? null : asNumber(row.expires_at),
    status: asString(row.status) as InteractionApprovalStatus,
    resolution: parseJson<ApprovalResolution | null>(row.resolution_json, null),
    resolvedBy: asNullableString(row.resolved_by),
    resolvedAt: row.resolved_at == null ? null : asNumber(row.resolved_at),
    error: asNullableString(row.error),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
}

function mapOwnedInteraction(row: SqlRow): OwnedInteractionRecord {
  const conversationId = asString(row.conversation_id);
  return {
    ...mapInteraction(row),
    ownerId: asString(row.owner_id),
    canvasId: asString(row.canvas_id),
    conversationId,
    backendId: asString(row.backend_id),
    agentProfileId: asString(row.agent_profile_id),
    conversationRef: parseBackendHandle(row.conversation_ref_json) || undefined,
    conversationInstanceId: asNullableString(row.conversation_instance_id),
    observedConversationInstanceId: asNullableString(row.observed_conversation_instance_id),
    conversationIntegrity: (asString(row.conversation_integrity) || 'unknown') as BranchConversationIntegrity,
  };
}

export class CanvasStore {
  readonly db: DatabaseSync;

  constructor(databasePath = config.canvasDatabasePath) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const existingCanvasColumns = this.db.prepare('PRAGMA table_info(canvases)').all() as SqlRow[];
    if (
      existingCanvasColumns.length > 0
      && !existingCanvasColumns.some((column) => asString(column.name) === 'agent_id')
    ) {
      ensureGenericAgentBackendSchema(this.db, packageMetadata.version);
      return;
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS canvas_users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS canvases (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES canvas_users(id),
        name TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        backend_id TEXT NOT NULL DEFAULT 'openclaw',
        agent_profile_id TEXT,
        agent_locked_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS branches (
        id TEXT PRIMARY KEY,
        canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('root', 'fork')),
        parent_branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
        forked_from_interaction_id TEXT,
        session_key TEXT NOT NULL UNIQUE,
        conversation_ref_json TEXT,
        observed_conversation_ref_json TEXT,
        openclaw_session_id TEXT,
        openclaw_session_started_at INTEGER,
        observed_session_id TEXT,
        observed_session_started_at INTEGER,
        session_integrity TEXT NOT NULL DEFAULT 'unknown',
        session_state TEXT NOT NULL CHECK(session_state IN ('draft', 'active')),
        creation_mode TEXT NOT NULL DEFAULT 'composer'
          CHECK(creation_mode IN ('composer', 'direct-submit')),
        head_interaction_id TEXT,
        snapshot_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS interactions (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        parent_interaction_id TEXT,
        run_id TEXT,
        turn_ref_json TEXT,
        user_input TEXT NOT NULL,
        agent_output TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK(status IN ('streaming', 'completed', 'failed')),
        execution_state TEXT NOT NULL DEFAULT 'running',
        artifact_sync_state TEXT NOT NULL DEFAULT 'not_started',
        terminal_at INTEGER,
        error TEXT,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        artifacts_json TEXT NOT NULL DEFAULT '[]',
        session_metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS canvas_layouts (
        canvas_id TEXT PRIMARY KEY REFERENCES canvases(id) ON DELETE CASCADE,
        layout_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS canvas_attachments (
        canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
        attachment_id TEXT NOT NULL,
        content_hash TEXT,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(canvas_id, attachment_id)
      );
      CREATE TABLE IF NOT EXISTS send_reservations (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        expected_head_interaction_id TEXT,
        user_input TEXT NOT NULL,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        materialization TEXT NOT NULL,
        session_key TEXT NOT NULL,
        backend_id TEXT NOT NULL DEFAULT 'openclaw',
        conversation_ref_json TEXT,
        dispatch_recovery_ref_json TEXT,
        outgoing_message TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('prepared', 'acknowledged', 'failed')),
        run_id TEXT,
        interaction_id TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS interaction_artifacts (
        interaction_id TEXT NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        content_hash TEXT,
        gateway_artifact_id TEXT,
        backend_artifact_ref_json TEXT,
        name TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER,
        uri TEXT NOT NULL,
        source_uri TEXT,
        storage TEXT,
        available INTEGER NOT NULL DEFAULT 1,
        warning TEXT,
        ordinal INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(interaction_id, id)
      );
      CREATE TABLE IF NOT EXISTS canvas_media_derivatives (
        canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
        source_content_hash TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK(purpose IN ('delivery', 'thumbnail')),
        policy_version TEXT NOT NULL,
        derivative_id TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(canvas_id, source_content_hash, purpose, policy_version)
      );
      CREATE TABLE IF NOT EXISTS artifact_sync_jobs (
        interaction_id TEXT PRIMARY KEY REFERENCES interactions(id) ON DELETE CASCADE,
        state TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER,
        last_error TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS canvas_changes (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        canvas_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL DEFAULT 'upsert',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gateway_signal_inbox (
        event_key TEXT PRIMARY KEY,
        run_id TEXT,
        session_key TEXT,
        event TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        processed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS backend_event_inbox (
        event_key TEXT PRIMARY KEY,
        backend_id TEXT NOT NULL,
        conversation_ref_json TEXT,
        turn_ref_json TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        processed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS interaction_approvals (
        id TEXT PRIMARY KEY,
        interaction_id TEXT NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
        backend_id TEXT NOT NULL,
        approval_ref_json TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        risk TEXT NOT NULL CHECK(risk IN ('low', 'medium', 'high')),
        permissions_json TEXT NOT NULL,
        choices_json TEXT NOT NULL,
        expires_at INTEGER,
        status TEXT NOT NULL CHECK(status IN ('pending', 'resolving', 'resolved', 'denied', 'expired', 'unconfirmed')),
        resolution_json TEXT,
        resolved_by TEXT,
        resolved_at INTEGER,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(backend_id, approval_ref_json)
      );
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        app_version TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_prepared_send_per_branch
        ON send_reservations(branch_id) WHERE status = 'prepared';
      CREATE INDEX IF NOT EXISTS canvas_owner_updated ON canvases(owner_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS interaction_branch_created ON interactions(branch_id, created_at);
      CREATE INDEX IF NOT EXISTS canvas_changes_canvas_seq ON canvas_changes(canvas_id, seq);
      CREATE INDEX IF NOT EXISTS gateway_signal_pending_run ON gateway_signal_inbox(run_id, processed_at);
      CREATE INDEX IF NOT EXISTS gateway_signal_pending_session ON gateway_signal_inbox(session_key, processed_at);
      CREATE INDEX IF NOT EXISTS backend_event_pending_turn
        ON backend_event_inbox(backend_id, turn_ref_json, processed_at);
      CREATE INDEX IF NOT EXISTS backend_event_pending_conversation
        ON backend_event_inbox(backend_id, conversation_ref_json, processed_at);
      CREATE INDEX IF NOT EXISTS interaction_approvals_interaction
        ON interaction_approvals(interaction_id, created_at);
    `);
    const reservationColumns = this.db.prepare('PRAGMA table_info(send_reservations)').all() as SqlRow[];
    this.db.exec('BEGIN');
    try {
      if (!reservationColumns.some((column) => asString(column.name) === 'bootstrap_resources_json')) {
        this.db.exec("ALTER TABLE send_reservations ADD COLUMN bootstrap_resources_json TEXT NOT NULL DEFAULT '[]'");
      }
      if (!reservationColumns.some((column) => asString(column.name) === 'dispatch_state')) {
        this.db.exec("ALTER TABLE send_reservations ADD COLUMN dispatch_state TEXT NOT NULL DEFAULT 'reserved'");
        this.db.exec(`UPDATE send_reservations
          SET dispatch_state = CASE status
            WHEN 'acknowledged' THEN 'acknowledged'
            WHEN 'failed' THEN 'failed'
            ELSE 'ambiguous'
          END`);
      }
      if (!reservationColumns.some((column) => asString(column.name) === 'attempt_count')) {
        this.db.exec('ALTER TABLE send_reservations ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0');
      }
      if (!reservationColumns.some((column) => asString(column.name) === 'last_attempt_at')) {
        this.db.exec('ALTER TABLE send_reservations ADD COLUMN last_attempt_at INTEGER');
      }
      if (!reservationColumns.some((column) => asString(column.name) === 'next_attempt_at')) {
        this.db.exec('ALTER TABLE send_reservations ADD COLUMN next_attempt_at INTEGER');
      }
      if (!reservationColumns.some((column) => asString(column.name) === 'backend_id')) {
        this.db.exec("ALTER TABLE send_reservations ADD COLUMN backend_id TEXT NOT NULL DEFAULT 'openclaw'");
      }
      if (!reservationColumns.some((column) => asString(column.name) === 'conversation_ref_json')) {
        this.db.exec('ALTER TABLE send_reservations ADD COLUMN conversation_ref_json TEXT');
      }
      if (!reservationColumns.some((column) => asString(column.name) === 'dispatch_recovery_ref_json')) {
        this.db.exec('ALTER TABLE send_reservations ADD COLUMN dispatch_recovery_ref_json TEXT');
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    const userColumns = this.db.prepare('PRAGMA table_info(canvas_users)').all() as SqlRow[];
    if (!userColumns.some((column) => asString(column.name) === 'token_hash')) {
      this.db.exec('ALTER TABLE canvas_users ADD COLUMN token_hash TEXT');
    }
    if (!userColumns.some((column) => asString(column.name) === 'token_version')) {
      this.db.exec('ALTER TABLE canvas_users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1');
    }
    if (!userColumns.some((column) => asString(column.name) === 'status')) {
      this.db.exec("ALTER TABLE canvas_users ADD COLUMN status TEXT NOT NULL DEFAULT 'unmanaged'");
    }
    const attachmentColumns = this.db.prepare('PRAGMA table_info(canvas_attachments)').all() as SqlRow[];
    if (!attachmentColumns.some((column) => asString(column.name) === 'content_hash')) {
      this.db.exec('ALTER TABLE canvas_attachments ADD COLUMN content_hash TEXT');
    }
    const artifactColumns = this.db.prepare('PRAGMA table_info(interaction_artifacts)').all() as SqlRow[];
    if (!artifactColumns.some((column) => asString(column.name) === 'content_hash')) {
      this.db.exec('ALTER TABLE interaction_artifacts ADD COLUMN content_hash TEXT');
    }
    if (!artifactColumns.some((column) => asString(column.name) === 'backend_artifact_ref_json')) {
      this.db.exec('ALTER TABLE interaction_artifacts ADD COLUMN backend_artifact_ref_json TEXT');
    }
    const canvasColumns = this.db.prepare('PRAGMA table_info(canvases)').all() as SqlRow[];
    if (!canvasColumns.some((column) => asString(column.name) === 'backend_id')) {
      this.db.exec("ALTER TABLE canvases ADD COLUMN backend_id TEXT NOT NULL DEFAULT 'openclaw'");
    }
    if (!canvasColumns.some((column) => asString(column.name) === 'agent_profile_id')) {
      this.db.exec('ALTER TABLE canvases ADD COLUMN agent_profile_id TEXT');
    }
    if (!canvasColumns.some((column) => asString(column.name) === 'agent_locked_at')) {
      this.db.exec('ALTER TABLE canvases ADD COLUMN agent_locked_at INTEGER');
    }
    const branchColumns = this.db.prepare('PRAGMA table_info(branches)').all() as SqlRow[];
    if (!branchColumns.some((column) => asString(column.name) === 'openclaw_session_id')) {
      this.db.exec('ALTER TABLE branches ADD COLUMN openclaw_session_id TEXT');
    }
    if (!branchColumns.some((column) => asString(column.name) === 'observed_session_id')) {
      this.db.exec('ALTER TABLE branches ADD COLUMN observed_session_id TEXT');
    }
    if (!branchColumns.some((column) => asString(column.name) === 'session_integrity')) {
      this.db.exec("ALTER TABLE branches ADD COLUMN session_integrity TEXT NOT NULL DEFAULT 'unknown'");
    }
    if (!branchColumns.some((column) => asString(column.name) === 'openclaw_session_started_at')) {
      this.db.exec('ALTER TABLE branches ADD COLUMN openclaw_session_started_at INTEGER');
    }
    if (!branchColumns.some((column) => asString(column.name) === 'observed_session_started_at')) {
      this.db.exec('ALTER TABLE branches ADD COLUMN observed_session_started_at INTEGER');
    }
    if (!branchColumns.some((column) => asString(column.name) === 'creation_mode')) {
      this.db.exec("ALTER TABLE branches ADD COLUMN creation_mode TEXT NOT NULL DEFAULT 'composer'");
    }
    if (!branchColumns.some((column) => asString(column.name) === 'conversation_ref_json')) {
      this.db.exec('ALTER TABLE branches ADD COLUMN conversation_ref_json TEXT');
    }
    if (!branchColumns.some((column) => asString(column.name) === 'observed_conversation_ref_json')) {
      this.db.exec('ALTER TABLE branches ADD COLUMN observed_conversation_ref_json TEXT');
    }
    this.db.exec(`
      DROP INDEX IF EXISTS one_draft_root_per_canvas;
      DROP INDEX IF EXISTS one_draft_fork_per_source;
      CREATE UNIQUE INDEX one_draft_root_per_canvas
        ON branches(canvas_id)
        WHERE kind = 'root' AND session_state = 'draft' AND creation_mode = 'composer';
      CREATE UNIQUE INDEX one_draft_fork_per_source
        ON branches(forked_from_interaction_id)
        WHERE kind = 'fork' AND session_state = 'draft' AND creation_mode = 'composer';
    `);
    const interactionColumns = this.db.prepare('PRAGMA table_info(interactions)').all() as SqlRow[];
    this.db.exec('BEGIN');
    try {
      if (!interactionColumns.some((column) => asString(column.name) === 'version')) {
        this.db.exec('ALTER TABLE interactions ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
      }
      if (!interactionColumns.some((column) => asString(column.name) === 'execution_state')) {
        this.db.exec("ALTER TABLE interactions ADD COLUMN execution_state TEXT NOT NULL DEFAULT 'running'");
      }
      if (!interactionColumns.some((column) => asString(column.name) === 'artifact_sync_state')) {
        this.db.exec("ALTER TABLE interactions ADD COLUMN artifact_sync_state TEXT NOT NULL DEFAULT 'not_started'");
      }
      if (!interactionColumns.some((column) => asString(column.name) === 'terminal_at')) {
        this.db.exec('ALTER TABLE interactions ADD COLUMN terminal_at INTEGER');
      }
      if (!interactionColumns.some((column) => asString(column.name) === 'error')) {
        this.db.exec('ALTER TABLE interactions ADD COLUMN error TEXT');
      }
      if (!interactionColumns.some((column) => asString(column.name) === 'turn_ref_json')) {
        this.db.exec('ALTER TABLE interactions ADD COLUMN turn_ref_json TEXT');
      }
      applySingleChainSchemaMigration(this.db, packageMetadata.version);
      this.db.exec(`
        UPDATE canvases SET backend_id = 'openclaw' WHERE backend_id IS NULL OR backend_id = '';
        UPDATE canvases SET agent_profile_id = agent_id WHERE agent_profile_id IS NULL OR agent_profile_id = '';
        UPDATE branches SET conversation_ref_json = json_object(
          'backendId', 'openclaw', 'schemaVersion', 1,
          'opaque', json_object('sessionKey', session_key)
        ) WHERE conversation_ref_json IS NULL;
        UPDATE branches SET observed_conversation_ref_json = json_object(
          'backendId', 'openclaw', 'schemaVersion', 1,
          'opaque', json_object('sessionKey', session_key, 'sessionId', observed_session_id)
        ) WHERE observed_conversation_ref_json IS NULL AND observed_session_id IS NOT NULL;
        UPDATE interactions SET turn_ref_json = json_object(
          'backendId', 'openclaw', 'schemaVersion', 1,
          'opaque', json_object('runId', run_id)
        ) WHERE turn_ref_json IS NULL AND run_id IS NOT NULL;
        UPDATE send_reservations SET backend_id = 'openclaw' WHERE backend_id IS NULL OR backend_id = '';
        UPDATE send_reservations SET conversation_ref_json = json_object(
          'backendId', 'openclaw', 'schemaVersion', 1,
          'opaque', json_object('sessionKey', session_key)
        ) WHERE conversation_ref_json IS NULL;
        UPDATE interaction_artifacts SET backend_artifact_ref_json = json_object(
          'backendId', 'openclaw', 'schemaVersion', 1,
          'opaque', json_object('artifactId', gateway_artifact_id)
        ) WHERE backend_artifact_ref_json IS NULL AND gateway_artifact_id IS NOT NULL;
      `);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS interaction_visible_version_v1
      AFTER UPDATE OF agent_output, status, execution_state, artifact_sync_state, terminal_at, error
      ON interactions
      WHEN NEW.version = OLD.version
      BEGIN
        UPDATE interactions SET version = OLD.version + 1 WHERE id = NEW.id;
      END;
      CREATE TRIGGER IF NOT EXISTS interaction_insert_change_v1
      AFTER INSERT ON interactions
      BEGIN
        INSERT INTO canvas_changes(canvas_id, entity_type, entity_id, operation, created_at)
        SELECT b.canvas_id, 'interaction', NEW.id, 'upsert', CAST(unixepoch('subsec') * 1000 AS INTEGER)
        FROM branches b WHERE b.id = NEW.branch_id;
      END;
      CREATE TRIGGER IF NOT EXISTS interaction_update_change_v1
      AFTER UPDATE OF version ON interactions
      WHEN NEW.version != OLD.version
      BEGIN
        INSERT INTO canvas_changes(canvas_id, entity_type, entity_id, operation, created_at)
        SELECT b.canvas_id, 'interaction', NEW.id, 'upsert', CAST(unixepoch('subsec') * 1000 AS INTEGER)
        FROM branches b WHERE b.id = NEW.branch_id;
      END;
      CREATE TRIGGER IF NOT EXISTS branch_insert_change_v1
      AFTER INSERT ON branches
      BEGIN
        INSERT INTO canvas_changes(canvas_id, entity_type, entity_id, operation, created_at)
        VALUES (NEW.canvas_id, 'branch', NEW.id, 'upsert', CAST(unixepoch('subsec') * 1000 AS INTEGER));
      END;
      CREATE TRIGGER IF NOT EXISTS branch_update_change_v1
      AFTER UPDATE OF session_state, head_interaction_id, openclaw_session_id,
        observed_session_id, session_integrity ON branches
      BEGIN
        INSERT INTO canvas_changes(canvas_id, entity_type, entity_id, operation, created_at)
        VALUES (NEW.canvas_id, 'branch', NEW.id, 'upsert', CAST(unixepoch('subsec') * 1000 AS INTEGER));
      END;
      CREATE TRIGGER IF NOT EXISTS send_insert_change_v1
      AFTER INSERT ON send_reservations
      BEGIN
        INSERT INTO canvas_changes(canvas_id, entity_type, entity_id, operation, created_at)
        SELECT b.canvas_id, 'send_operation', NEW.id, 'upsert', CAST(unixepoch('subsec') * 1000 AS INTEGER)
        FROM branches b WHERE b.id = NEW.branch_id;
      END;
      CREATE TRIGGER IF NOT EXISTS send_update_change_v1
      AFTER UPDATE OF status, dispatch_state, error, next_attempt_at, interaction_id ON send_reservations
      BEGIN
        INSERT INTO canvas_changes(canvas_id, entity_type, entity_id, operation, created_at)
        SELECT b.canvas_id, 'send_operation', NEW.id, 'upsert', CAST(unixepoch('subsec') * 1000 AS INTEGER)
        FROM branches b WHERE b.id = NEW.branch_id;
      END;
      CREATE TRIGGER IF NOT EXISTS canvas_update_change_v1
      AFTER UPDATE OF name, agent_id ON canvases
      BEGIN
        INSERT INTO canvas_changes(canvas_id, entity_type, entity_id, operation, created_at)
        VALUES (NEW.id, 'canvas', NEW.id, 'upsert', CAST(unixepoch('subsec') * 1000 AS INTEGER));
      END;
      CREATE TRIGGER IF NOT EXISTS approval_insert_visible_v1
      AFTER INSERT ON interaction_approvals
      BEGIN
        UPDATE interactions SET version = version + 1, updated_at = NEW.updated_at
        WHERE id = NEW.interaction_id;
      END;
      CREATE TRIGGER IF NOT EXISTS approval_update_visible_v1
      AFTER UPDATE OF status, resolution_json, resolved_by, resolved_at, error
      ON interaction_approvals
      BEGIN
        UPDATE interactions SET version = version + 1, updated_at = NEW.updated_at
        WHERE id = NEW.interaction_id;
      END;
    `);
    this.db.exec(`
      UPDATE branches
      SET openclaw_session_started_at = COALESCE(
        (SELECT MIN(i.created_at) FROM interactions i WHERE i.branch_id = branches.id),
        created_at
      )
      WHERE openclaw_session_id IS NOT NULL
        AND openclaw_session_started_at IS NULL;
      UPDATE branches
      SET observed_session_started_at = CASE
        WHEN observed_session_id = openclaw_session_id THEN openclaw_session_started_at
        ELSE updated_at
      END
      WHERE observed_session_id IS NOT NULL
        AND observed_session_started_at IS NULL;
    `);
    ensureGenericAgentBackendSchema(this.db, packageMetadata.version);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private listInteractionArtifacts(interactionId: string): CanvasArtifact[] {
    const rows = this.db.prepare(`SELECT * FROM interaction_artifacts
      WHERE interaction_id = ? ORDER BY ordinal, id`).all(interactionId) as SqlRow[];
    return rows.map((row) => ({
      id: asString(row.id),
      ...(asNullableString(row.content_hash) ? { contentHash: asString(row.content_hash) } : {}),
      ...(asNullableString(row.backend_artifact_id) ? { backendArtifactId: asString(row.backend_artifact_id) } : {}),
      ...(parseBackendHandle(row.backend_artifact_ref_json)
        ? { backendArtifactRef: parseBackendHandle(row.backend_artifact_ref_json)! }
        : {}),
      name: asString(row.name),
      ...(asNullableString(row.mime_type) ? { mimeType: asString(row.mime_type) } : {}),
      ...(row.size_bytes == null ? {} : { sizeBytes: asNumber(row.size_bytes) }),
      uri: asString(row.uri),
      ...(asNullableString(row.source_uri) ? { sourceUri: asString(row.source_uri) } : {}),
      ...(asNullableString(row.storage) ? { storage: asString(row.storage) as CanvasArtifact['storage'] } : {}),
      available: asNumber(row.available) !== 0,
      ...(asNullableString(row.warning) ? { warning: asString(row.warning) } : {}),
    }));
  }

  private hydrateInteraction(record: InteractionRecord): InteractionRecord {
    return {
      ...record,
      artifacts: this.listInteractionArtifacts(record.id),
      approvals: this.listInteractionApprovals(record.id),
    };
  }

  private hydrateOwnedInteraction(record: OwnedInteractionRecord): OwnedInteractionRecord {
    return {
      ...record,
      artifacts: this.listInteractionArtifacts(record.id),
      approvals: this.listInteractionApprovals(record.id),
    };
  }

  private listInteractionApprovals(interactionId: string): InteractionApprovalRecord[] {
    return (this.db.prepare(`SELECT * FROM interaction_approvals
      WHERE interaction_id = ? ORDER BY created_at, id`).all(interactionId) as SqlRow[])
      .map(mapInteractionApproval);
  }

  private normalizeInteractionArtifacts(interactionId: string, artifacts: CanvasArtifact[]): CanvasArtifact[] {
    return artifacts.map((artifact, index) => ({
      id: artifact.id || `${interactionId}:artifact:${index}`,
      ...(artifact.contentHash ? { contentHash: artifact.contentHash } : {}),
      ...(artifact.backendArtifactId ? { backendArtifactId: artifact.backendArtifactId } : {}),
      ...(artifact.backendArtifactRef ? { backendArtifactRef: artifact.backendArtifactRef } : {}),
      name: artifact.name,
      ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
      ...(artifact.sizeBytes === undefined ? {} : { sizeBytes: artifact.sizeBytes }),
      uri: artifact.uri,
      ...(artifact.sourceUri ? { sourceUri: artifact.sourceUri } : {}),
      ...(artifact.storage ? { storage: artifact.storage } : {}),
      available: artifact.available !== false,
      ...(artifact.warning ? { warning: artifact.warning } : {}),
    }));
  }

  private replaceInteractionArtifacts(interactionId: string, artifacts: CanvasArtifact[], now: number): void {
    this.db.prepare('DELETE FROM interaction_artifacts WHERE interaction_id = ?').run(interactionId);
    const insert = this.db.prepare(`INSERT INTO interaction_artifacts
      (interaction_id, id, content_hash, backend_artifact_id, backend_artifact_ref_json, name, mime_type, size_bytes, uri,
        source_uri, storage, available, warning, ordinal, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.normalizeInteractionArtifacts(interactionId, artifacts).forEach((artifact, index) => {
      insert.run(
        interactionId,
        artifact.id || `${interactionId}:artifact:${index}`,
        artifact.contentHash || null,
        artifact.backendArtifactId || null,
        artifact.backendArtifactRef ? JSON.stringify(artifact.backendArtifactRef) : null,
        artifact.name,
        artifact.mimeType || null,
        artifact.sizeBytes ?? null,
        artifact.uri,
        artifact.sourceUri || null,
        artifact.storage || null,
        artifact.available === false ? 0 : 1,
        artifact.warning || null,
        index,
        now,
      );
    });
  }

  ensureUser(id: string, displayName: string): void {
    const now = Date.now();
    this.db.prepare(`INSERT INTO canvas_users(id, display_name, created_at, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`)
      .run(id, displayName, now, now);
  }

  listManagedUsers(): CanvasUserRecord[] {
    return (this.db.prepare(`SELECT u.*, COUNT(c.id) AS canvas_count
      FROM canvas_users u LEFT JOIN canvases c ON c.owner_id = u.id
      WHERE u.token_hash IS NOT NULL
      GROUP BY u.id ORDER BY u.display_name COLLATE NOCASE`).all() as SqlRow[]).map(mapCanvasUser);
  }

  listUsersWithCredentials(): CanvasUserRecord[] {
    return (this.db.prepare(`SELECT u.*, COUNT(c.id) AS canvas_count
      FROM canvas_users u LEFT JOIN canvases c ON c.owner_id = u.id
      WHERE u.token_hash IS NOT NULL
      GROUP BY u.id ORDER BY u.created_at`).all() as SqlRow[]).map(mapCanvasUser);
  }

  getManagedUserById(id: string): CanvasUserRecord | null {
    const row = this.db.prepare(`SELECT u.*, COUNT(c.id) AS canvas_count
      FROM canvas_users u LEFT JOIN canvases c ON c.owner_id = u.id
      WHERE u.id = ? AND u.token_hash IS NOT NULL GROUP BY u.id`).get(id) as SqlRow | undefined;
    return row ? mapCanvasUser(row) : null;
  }

  getManagedUserByName(displayName: string): CanvasUserRecord | null {
    const row = this.db.prepare(`SELECT u.*, COUNT(c.id) AS canvas_count
      FROM canvas_users u LEFT JOIN canvases c ON c.owner_id = u.id
      WHERE u.display_name = ? COLLATE NOCASE AND u.token_hash IS NOT NULL GROUP BY u.id`).get(displayName) as SqlRow | undefined;
    return row ? mapCanvasUser(row) : null;
  }

  createManagedUser(displayName: string, tokenHash: string): { user: CanvasUserRecord; claimedCanvasCount: number } {
    return this.transaction(() => {
      const duplicate = this.db.prepare('SELECT id FROM canvas_users WHERE display_name = ? COLLATE NOCASE').get(displayName);
      if (duplicate) throw new Error('user_exists');
      const firstManaged = asNumber((this.db.prepare('SELECT COUNT(*) AS count FROM canvas_users WHERE token_hash IS NOT NULL').get() as SqlRow).count) === 0;
      const id = randomUUID();
      const now = Date.now();
      this.db.prepare(`INSERT INTO canvas_users(id, display_name, token_hash, token_version, status, created_at, updated_at)
        VALUES (?, ?, ?, 1, 'active', ?, ?)`).run(id, displayName, tokenHash, now, now);
      let claimedCanvasCount = 0;
      if (firstManaged) {
        const result = this.db.prepare("UPDATE canvases SET owner_id = ?, updated_at = ? WHERE owner_id = 'local'").run(id, now);
        claimedCanvasCount = Number(result.changes);
      }
      return { user: this.getManagedUserById(id)!, claimedCanvasCount };
    });
  }

  rotateManagedUserToken(displayName: string, tokenHash: string): CanvasUserRecord {
    return this.transaction(() => {
      const user = this.getManagedUserByName(displayName);
      if (!user) throw new Error('user_not_found');
      this.db.prepare(`UPDATE canvas_users SET token_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?`)
        .run(tokenHash, Date.now(), user.id);
      return this.getManagedUserById(user.id)!;
    });
  }

  setManagedUserStatus(displayName: string, status: Exclude<CanvasUserStatus, 'unmanaged'>): CanvasUserRecord {
    return this.transaction(() => {
      const user = this.getManagedUserByName(displayName);
      if (!user) throw new Error('user_not_found');
      if (user.status !== status) {
        this.db.prepare(`UPDATE canvas_users SET status = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?`)
          .run(status, Date.now(), user.id);
      }
      return this.getManagedUserById(user.id)!;
    });
  }

  listCanvases(ownerId: string): CanvasRecord[] {
    return (this.db.prepare('SELECT * FROM canvases WHERE owner_id = ? ORDER BY updated_at DESC').all(ownerId) as SqlRow[]).map(mapCanvas);
  }

  createCanvas(ownerId: string, name: string, agentRef: AgentProfileRef): CanvasRecord {
    const now = Date.now();
    const id = randomUUID();
    this.db.prepare(`INSERT INTO canvases
      (id, owner_id, name, backend_id, agent_profile_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        ownerId,
        name,
        agentRef.backendId,
        agentRef.profileId,
        now,
        now,
      );
    return this.getCanvas(ownerId, id)!;
  }

  getCanvas(ownerId: string, id: string): CanvasRecord | null {
    const row = this.db.prepare('SELECT * FROM canvases WHERE id = ? AND owner_id = ?').get(id, ownerId) as SqlRow | undefined;
    return row ? mapCanvas(row) : null;
  }

  canvasExists(id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM canvases WHERE id = ?').get(id));
  }

  updateCanvas(ownerId: string, id: string, name: string): CanvasRecord | null {
    this.db.prepare('UPDATE canvases SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?').run(name, Date.now(), id, ownerId);
    return this.getCanvas(ownerId, id);
  }

  updateCanvasAgentBeforeFirstInteraction(ownerId: string, id: string, agentRef: AgentProfileRef): CanvasRecord | null {
    return this.transaction(() => {
      const canvas = this.getCanvas(ownerId, id);
      if (!canvas) return null;
      if (
        canvas.agentRef.backendId === agentRef.backendId
        && canvas.agentRef.profileId === agentRef.profileId
      ) return canvas;

      if (!canvas.agentMutable) throw new Error('agent_locked');
      const hasAgentLockingActivity = this.db.prepare(`SELECT 1
        FROM branches AS branch
        WHERE branch.canvas_id = ?
          AND (
            EXISTS (SELECT 1 FROM send_reservations AS reservation
              WHERE reservation.branch_id = branch.id)
            OR EXISTS (SELECT 1 FROM interactions AS interaction
              WHERE interaction.branch_id = branch.id)
          )
        LIMIT 1`).get(id);
      if (hasAgentLockingActivity) throw new Error('agent_locked');

      const now = Date.now();
      this.db.prepare(`UPDATE canvases SET backend_id = ?, agent_profile_id = ?, updated_at = ?
        WHERE id = ? AND owner_id = ?`)
        .run(agentRef.backendId, agentRef.profileId, now, id, ownerId);
      const draftBranches = this.db.prepare(
        "SELECT id FROM branches WHERE canvas_id = ? AND conversation_state = 'draft'",
      ).all(id) as SqlRow[];
      const updateBranch = this.db.prepare(
        `UPDATE branches SET conversation_id = ?, conversation_ref_json = ?, updated_at = ?
          WHERE id = ? AND conversation_state = 'draft'`,
      );
      for (const branch of draftBranches) {
        const branchId = asString(branch.id);
        const conversationRef = getAgentBackend(agentRef.backendId).createConversationHandle({
          profile: agentRef,
          localConversationId: branchId,
        });
        const conversationId = branchId;
        updateBranch.run(conversationId, JSON.stringify(conversationRef), now, branchId);
      }
      return this.getCanvas(ownerId, id);
    });
  }

  deleteCanvas(ownerId: string, id: string): boolean {
    return Number(this.db.prepare('DELETE FROM canvases WHERE id = ? AND owner_id = ?').run(id, ownerId).changes) > 0;
  }

  createRootBranch(ownerId: string, canvasId: string): BranchRecord {
    const canvas = this.getCanvas(ownerId, canvasId);
    if (!canvas) throw new Error('not_found');
    const existing = this.db.prepare(`SELECT b.* FROM branches b JOIN canvases c ON c.id = b.canvas_id
      WHERE b.canvas_id = ? AND c.owner_id = ? AND b.kind = 'root'
        AND b.conversation_state = 'draft' AND b.creation_mode = 'composer'`).get(canvasId, ownerId) as SqlRow | undefined;
    if (existing) return mapBranch(existing);
    return this.insertBranch(canvasId, 'root', null, null, null, canvas.agentRef);
  }

  private insertBranch(
    canvasId: string,
    kind: BranchKind,
    parentBranchId: string | null,
    forkedFromInteractionId: string | null,
    snapshot: unknown,
    agentRef: AgentProfileRef,
    creationMode: BranchCreationMode = 'composer',
  ): BranchRecord {
    const id = randomUUID();
    const now = Date.now();
    const conversationRef = getAgentBackend(agentRef.backendId).createConversationHandle({
      profile: agentRef,
      localConversationId: id,
    });
    const conversationId = id;
    this.db.prepare(`INSERT INTO branches
      (id, canvas_id, kind, parent_branch_id, forked_from_interaction_id, conversation_id,
        conversation_ref_json, conversation_state, creation_mode, snapshot_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`)
      .run(
        id,
        canvasId,
        kind,
        parentBranchId,
        forkedFromInteractionId,
        conversationId,
        JSON.stringify(conversationRef),
        creationMode,
        snapshot == null ? null : JSON.stringify(snapshot),
        now,
        now,
      );
    return this.getBranchById(id)!;
  }

  private getBranchById(id: string): BranchRecord | null {
    const row = this.db.prepare('SELECT * FROM branches WHERE id = ?').get(id) as SqlRow | undefined;
    return row ? mapBranch(row) : null;
  }

  getOwnedBranch(ownerId: string, id: string): BranchRecord | null {
    const row = this.db.prepare(`SELECT b.* FROM branches b JOIN canvases c ON c.id = b.canvas_id
      WHERE b.id = ? AND c.owner_id = ?`).get(id, ownerId) as SqlRow | undefined;
    return row ? mapBranch(row) : null;
  }

  getOwnedBranchConversationLifecycle(ownerId: string, branchId: string): BranchConversationLifecycle | null {
    const row = this.db.prepare(`SELECT
        b.conversation_started_at,
        b.observed_conversation_started_at,
        (SELECT i.created_at FROM interactions i
          WHERE i.id = b.head_interaction_id) AS last_interaction_at
      FROM branches b JOIN canvases c ON c.id = b.canvas_id
      WHERE b.id = ? AND c.owner_id = ?`).get(branchId, ownerId) as SqlRow | undefined;
    if (!row) return null;
    const nullableNumber = (value: unknown): number | null =>
      value === null || value === undefined ? null : asNumber(value);
    return {
      conversationStartedAt: nullableNumber(row.conversation_started_at),
      observedConversationStartedAt: nullableNumber(row.observed_conversation_started_at),
      lastInteractionAt: nullableNumber(row.last_interaction_at),
    };
  }

  getOwnedBranchBackendContext(ownerId: string, branchId: string): BranchBackendContext | null {
    const row = this.db.prepare(`SELECT b.conversation_id, b.conversation_ref_json,
        b.observed_conversation_ref_json, b.conversation_started_at,
        b.observed_conversation_started_at, c.backend_id, c.agent_profile_id,
        (SELECT i.created_at FROM interactions i WHERE i.id = b.head_interaction_id) AS last_interaction_at
      FROM branches b JOIN canvases c ON c.id = b.canvas_id
      WHERE b.id = ? AND c.owner_id = ?`).get(branchId, ownerId) as SqlRow | undefined;
    if (!row) return null;
    const nullableNumber = (value: unknown): number | null =>
      value === null || value === undefined ? null : asNumber(value);
    const conversationRef = parseBackendHandle(row.conversation_ref_json);
    if (!conversationRef) return null;
    return {
      backendId: asString(row.backend_id),
      agentProfileId: asString(row.agent_profile_id),
      conversationRef,
      observedConversationRef: parseBackendHandle(row.observed_conversation_ref_json),
      conversationStartedAt: nullableNumber(row.conversation_started_at),
      observedConversationStartedAt: nullableNumber(row.observed_conversation_started_at),
      lastInteractionAt: nullableNumber(row.last_interaction_at),
    };
  }

  observeBranchConversation(
    branchId: string,
    conversationRef: BackendHandle,
    instanceId?: string,
    observedAt = Date.now(),
  ): BranchRecord | null {
    const branch = this.getBranchById(branchId);
    if (!branch) return null;
    const normalizedInstanceId = instanceId?.trim();
    if (!normalizedInstanceId) {
      this.db.prepare(`UPDATE branches SET observed_conversation_ref_json = ?, updated_at = ?
        WHERE id = ?`).run(JSON.stringify(conversationRef), observedAt, branchId);
      return this.getBranchById(branchId);
    }
    if (!branch.conversationInstanceId) {
      this.db.prepare(`UPDATE branches
        SET conversation_instance_id = ?, conversation_started_at = ?,
          observed_conversation_instance_id = ?, observed_conversation_started_at = ?,
          conversation_ref_json = ?, observed_conversation_ref_json = ?,
          conversation_integrity = 'healthy', updated_at = ?
        WHERE id = ?`).run(
          normalizedInstanceId, observedAt, normalizedInstanceId, observedAt,
          JSON.stringify(conversationRef), JSON.stringify(conversationRef),
          observedAt, branchId,
        );
    } else if (branch.conversationInstanceId === normalizedInstanceId) {
      this.db.prepare(`UPDATE branches
        SET conversation_started_at = COALESCE(conversation_started_at, ?),
          observed_conversation_instance_id = ?,
          observed_conversation_started_at = COALESCE(conversation_started_at, ?),
          conversation_ref_json = ?, observed_conversation_ref_json = ?,
          conversation_integrity = 'healthy', updated_at = ?
        WHERE id = ?`).run(
          observedAt, normalizedInstanceId, observedAt,
          JSON.stringify(conversationRef), JSON.stringify(conversationRef),
          observedAt, branchId,
        );
    } else {
      this.db.prepare(`UPDATE branches
        SET observed_conversation_started_at = CASE
          WHEN observed_conversation_instance_id = ? THEN observed_conversation_started_at
          ELSE ? END,
          observed_conversation_instance_id = ?, observed_conversation_ref_json = ?,
          conversation_integrity = 'drifted', updated_at = ?
        WHERE id = ?`).run(
          normalizedInstanceId, observedAt, normalizedInstanceId,
          JSON.stringify(conversationRef), observedAt, branchId,
        );
    }
    return this.getBranchById(branchId);
  }

  markBranchConversationMissing(branchId: string): BranchRecord | null {
    const branch = this.getBranchById(branchId);
    if (!branch) return null;
    this.db.prepare(`UPDATE branches
      SET observed_conversation_instance_id = NULL, observed_conversation_started_at = NULL,
        observed_conversation_ref_json = NULL,
        conversation_integrity = 'drifted', updated_at = ?
      WHERE id = ?`).run(Date.now(), branchId);
    return this.getBranchById(branchId);
  }

  adoptRecoveredInteractionConversation(
    interactionId: string,
    sessionId: string,
    observedAt = Date.now(),
  ): BranchRecord | null {
    const normalized = sessionId.trim();
    if (!normalized) return null;
    const row = this.db.prepare(`SELECT i.branch_id, i.execution_state, i.execution_metadata_json
      FROM interactions i WHERE i.id = ?`).get(interactionId) as SqlRow | undefined;
    if (!row || asString(row.execution_state) !== 'completed') return null;
    const metadata = parseJson<Record<string, unknown>>(row.execution_metadata_json, {});
    if (metadata.materialization !== 'session-recovery') return null;
    const branchId = asString(row.branch_id);
    this.db.prepare(`UPDATE branches
      SET conversation_instance_id = ?, conversation_started_at = ?,
        observed_conversation_instance_id = ?, observed_conversation_started_at = ?,
        conversation_integrity = 'healthy', updated_at = ?
      WHERE id = ?`)
      .run(normalized, observedAt, normalized, observedAt, observedAt, branchId);
    return this.getBranchById(branchId);
  }

  forkInteraction(ownerId: string, interactionId: string): BranchRecord {
    const sourceRow = this.db.prepare(`SELECT i.*, b.canvas_id, b.head_interaction_id,
        c.backend_id, c.agent_profile_id, c.owner_id
      FROM interactions i JOIN branches b ON b.id = i.branch_id JOIN canvases c ON c.id = b.canvas_id
      WHERE i.id = ? AND c.owner_id = ?`).get(interactionId, ownerId) as SqlRow | undefined;
    if (!sourceRow) throw new Error('not_found');
    if (asString(sourceRow.execution_state) !== 'completed') throw new Error('interaction_not_completed');
    if (asNullableString(sourceRow.head_interaction_id) === interactionId) throw new Error('cannot_fork_branch_head');

    const existing = this.db.prepare(`SELECT * FROM branches
      WHERE forked_from_interaction_id = ? AND conversation_state = 'draft'
        AND creation_mode = 'composer'`)
      .get(interactionId) as SqlRow | undefined;
    if (existing) return mapBranch(existing);

    const snapshot = this.buildCanonicalSnapshot(interactionId);
    return this.insertBranch(
      asString(sourceRow.canvas_id),
      'fork',
      asString(sourceRow.branch_id),
      interactionId,
      snapshot,
      {
        backendId: asString(sourceRow.backend_id),
        profileId: asString(sourceRow.agent_profile_id),
      },
    );
  }

  private buildCanonicalSnapshot(interactionId: string): CanonicalCanvasSnapshot {
    const rows: SqlRow[] = [];
    let cursor: string | null = interactionId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const row = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(cursor) as SqlRow | undefined;
      if (!row) break;
      rows.push(row);
      cursor = asNullableString(row.parent_interaction_id);
    }
    rows.reverse();

    return assembleCanonicalCanvasSnapshot(rows.map((row) => {
      const id = asString(row.id);
      return {
        id,
        user: asString(row.user_input),
        assistant: asString(row.agent_output),
        attachments: parseJson<CanvasAttachment[]>(row.attachments_json, []),
        artifacts: this.listInteractionArtifacts(id),
      };
    }));
  }

  prepareSend(ownerId: string, input: {
    branchId: string;
    expectedHeadInteractionId?: string | null;
    userInput: string;
    attachments: CanvasAttachment[];
    forceSessionRecovery?: boolean;
  }): SendReservation {
    return this.transaction(() => this.prepareSendInTransaction(ownerId, input));
  }

  prepareInteractionResubmission(ownerId: string, input: {
    interactionId: string;
    expectedAgentRef: AgentProfileRef;
    attachments: CanvasAttachment[];
  }): SendReservation {
    return this.transaction(() => {
      const source = this.db.prepare(`SELECT i.*, b.canvas_id, c.backend_id, c.agent_profile_id
        FROM interactions i
        JOIN branches b ON b.id = i.branch_id
        JOIN canvases c ON c.id = b.canvas_id
        WHERE i.id = ? AND c.owner_id = ?`).get(input.interactionId, ownerId) as SqlRow | undefined;
      if (!source) throw new Error('not_found');
      const agentRef = {
        backendId: asString(source.backend_id),
        profileId: asString(source.agent_profile_id),
      };
      if (
        agentRef.backendId !== input.expectedAgentRef.backendId
        || agentRef.profileId !== input.expectedAgentRef.profileId
      ) throw new Error('agent_changed');

      const sourceAttachments = parseJson<CanvasAttachment[]>(source.attachments_json, []);
      const sourceAttachmentIds = sourceAttachments
        .map((attachment) => attachment.id)
        .filter((id): id is string => Boolean(id));
      if (
        sourceAttachmentIds.length !== sourceAttachments.length
        || sourceAttachmentIds.length !== input.attachments.length
        || sourceAttachmentIds.some((id, index) => input.attachments[index]?.id !== id)
      ) {
        throw new Error('source_attachment_unavailable');
      }

      const canvasId = asString(source.canvas_id);
      const parentInteractionId = asNullableString(source.parent_interaction_id);
      let branch: BranchRecord;
      if (parentInteractionId) {
        const parent = this.db.prepare(`SELECT i.branch_id
          FROM interactions i
          JOIN branches b ON b.id = i.branch_id
          WHERE i.id = ? AND b.canvas_id = ?`).get(parentInteractionId, canvasId) as SqlRow | undefined;
        if (!parent) throw new Error('invalid_branch_transition');
        branch = this.insertBranch(
          canvasId,
          'fork',
          asString(parent.branch_id),
          parentInteractionId,
          this.buildCanonicalSnapshot(parentInteractionId),
          agentRef,
          'direct-submit',
        );
      } else {
        branch = this.insertBranch(
          canvasId,
          'root',
          null,
          null,
          null,
          agentRef,
          'direct-submit',
        );
      }

      return this.prepareSendInTransaction(ownerId, {
        branchId: branch.id,
        expectedHeadInteractionId: null,
        userInput: asString(source.user_input),
        attachments: input.attachments,
      });
    });
  }

  private prepareSendInTransaction(ownerId: string, input: {
    branchId: string;
    expectedHeadInteractionId?: string | null;
    userInput: string;
    attachments: CanvasAttachment[];
    forceSessionRecovery?: boolean;
  }): SendReservation {
    const branch = this.getOwnedBranch(ownerId, input.branchId);
    if (!branch) throw new Error('not_found');
    const backendContext = this.getOwnedBranchBackendContext(ownerId, input.branchId);
    if (!backendContext) throw new Error('not_found');
    const existing = this.db.prepare(`SELECT * FROM send_reservations
      WHERE branch_id = ? AND status = 'prepared'`).get(branch.id) as SqlRow | undefined;
    if (existing) throw new Error('send_in_progress');

    this.db.prepare(`UPDATE canvases SET agent_locked_at = COALESCE(agent_locked_at, ?)
      WHERE id = ? AND owner_id = ?`).run(Date.now(), branch.canvasId, ownerId);

    const decision = decideCanvasSendPlan({
      branch,
      expectedHeadInteractionId: input.expectedHeadInteractionId,
      forceSessionRecovery: input.forceSessionRecovery,
    });
    const materialization = decision.materialization;
    let outgoingMessage = input.userInput;
    const expectedHead = decision.expectedHeadInteractionId;
    let bootstrapResources: CanvasContextResource[] = [];

    if (decision.replayReason === 'canonical-replay') {
      const row = this.db.prepare('SELECT snapshot_json FROM branches WHERE id = ?').get(branch.id) as SqlRow;
      const snapshot = parseJson<CanonicalCanvasSnapshot>(row.snapshot_json, {
        version: 2,
        interactions: [],
        resources: [],
      });
      const replay = buildCanvasReplayPlan(snapshot, 'canonical-replay', input.userInput);
      bootstrapResources = replay.resources;
      outgoingMessage = replay.message;
    } else if (decision.replayReason === 'session-recovery' && branch.headInteractionId) {
      const snapshot = this.buildCanonicalSnapshot(branch.headInteractionId);
      const replay = buildCanvasReplayPlan(snapshot, 'session-recovery', input.userInput);
      bootstrapResources = replay.resources;
      outgoingMessage = replay.message;
    }

    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`INSERT INTO send_reservations
      (id, branch_id, expected_head_interaction_id, user_input, attachments_json,
        materialization, conversation_id, backend_id, conversation_ref_json,
        outgoing_message, bootstrap_resources_json,
        status, dispatch_state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', 'reserved', ?, ?)`)
      .run(
        id,
        branch.id,
        expectedHead,
        input.userInput,
        JSON.stringify(input.attachments),
        materialization,
        branch.conversationId,
        backendContext.backendId,
        JSON.stringify(backendContext.conversationRef),
        outgoingMessage,
        JSON.stringify(bootstrapResources),
        now,
        now,
      );
    return this.getReservation(id)!;
  }

  getReservation(id: string): SendReservation | null {
    const row = this.db.prepare('SELECT * FROM send_reservations WHERE id = ?').get(id) as SqlRow | undefined;
    if (!row) return null;
    const bootstrapResources = parseJson<CanvasContextResource[]>(row.bootstrap_resources_json, []);
    const conversationId = asString(row.conversation_id);
    return {
      id: asString(row.id),
      branchId: asString(row.branch_id),
      expectedHeadInteractionId: asNullableString(row.expected_head_interaction_id),
      userInput: asString(row.user_input),
      attachments: parseJson<CanvasAttachment[]>(row.attachments_json, []),
      materialization: asString(row.materialization) as SendMaterialization,
      conversationId,
      backendId: asString(row.backend_id),
      conversationRef: parseBackendHandle(row.conversation_ref_json) || undefined,
      dispatchRecoveryRef: parseBackendHandle(row.dispatch_recovery_ref_json),
      outgoingMessage: asString(row.outgoing_message),
      snapshotVersion: ['canonical-replay', 'session-recovery'].includes(asString(row.materialization)) ? 2 : undefined,
      bootstrapResources,
      status: asString(row.status) as SendReservation['status'],
      dispatchState: (asString(row.dispatch_state) || 'reserved') as SendDispatchState,
      attemptCount: asNumber(row.attempt_count),
      lastAttemptAt: row.last_attempt_at == null ? null : asNumber(row.last_attempt_at),
      nextAttemptAt: row.next_attempt_at == null ? null : asNumber(row.next_attempt_at),
      error: asNullableString(row.error),
      interactionId: asNullableString(row.interaction_id),
      createdAt: asNumber(row.created_at),
      updatedAt: asNumber(row.updated_at),
    };
  }

  getOwnedReservation(ownerId: string, id: string): SendReservation | null {
    const row = this.db.prepare(`SELECT r.id FROM send_reservations r
      JOIN branches b ON b.id = r.branch_id
      JOIN canvases c ON c.id = b.canvas_id
      WHERE r.id = ? AND c.owner_id = ?`).get(id, ownerId) as SqlRow | undefined;
    return row ? this.getReservation(id) : null;
  }

  getDispatchableReservation(id: string): DispatchableSendReservation | null {
    const row = this.db.prepare(`SELECT r.id, c.owner_id, c.id AS canvas_id, c.agent_profile_id,
        c.backend_id, c.agent_profile_id
      FROM send_reservations r
      JOIN branches b ON b.id = r.branch_id
      JOIN canvases c ON c.id = b.canvas_id
      WHERE r.id = ?`).get(id) as SqlRow | undefined;
    const reservation = row ? this.getReservation(id) : null;
    return reservation && row ? {
      ...reservation,
      ownerId: asString(row.owner_id),
      canvasId: asString(row.canvas_id),
      backendId: asString(row.backend_id) || reservation.backendId,
      agentProfileId: asString(row.agent_profile_id),
    } : null;
  }

  listDispatchableReservations(now = Date.now(), limit = 100): DispatchableSendReservation[] {
    const rows = this.db.prepare(`SELECT r.id
      FROM send_reservations r
      WHERE r.status = 'prepared'
        AND r.dispatch_state IN ('reserved', 'awaiting_media', 'dispatching', 'ambiguous')
        AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= ?)
      ORDER BY COALESCE(r.next_attempt_at, r.created_at), r.created_at
      LIMIT ?`).all(now, limit) as SqlRow[];
    return rows.flatMap((row) => {
      const reservation = this.getDispatchableReservation(asString(row.id));
      return reservation ? [reservation] : [];
    });
  }

  nextDispatchableReservationAt(now = Date.now()): number | null {
    const row = this.db.prepare(`SELECT MIN(COALESCE(next_attempt_at, ?)) AS next_at
      FROM send_reservations
      WHERE status = 'prepared'
        AND dispatch_state IN ('reserved', 'awaiting_media', 'dispatching', 'ambiguous')`)
      .get(now) as SqlRow | undefined;
    return row?.next_at == null ? null : asNumber(row.next_at);
  }

  markReservationDispatching(id: string): SendReservation | null {
    const now = Date.now();
    this.db.prepare(`UPDATE send_reservations
      SET dispatch_state = 'dispatching', attempt_count = attempt_count + 1,
        last_attempt_at = ?, next_attempt_at = NULL, error = NULL, updated_at = ?
      WHERE id = ? AND status = 'prepared'
        AND dispatch_state IN ('reserved', 'awaiting_media', 'dispatching', 'ambiguous')`)
      .run(now, now, id);
    return this.getReservation(id);
  }

  scheduleReservationRetry(id: string, state: 'reserved' | 'ambiguous', error: string, nextAttemptAt: number): SendReservation | null {
    this.db.prepare(`UPDATE send_reservations
      SET dispatch_state = ?, error = ?, next_attempt_at = ?, updated_at = ?
      WHERE id = ? AND status = 'prepared'`)
      .run(state, error, nextAttemptAt, Date.now(), id);
    return this.getReservation(id);
  }

  markReservationAwaitingMedia(id: string): SendReservation | null {
    this.db.prepare(`UPDATE send_reservations
      SET dispatch_state = 'awaiting_media', next_attempt_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'prepared'`).run(Date.now(), id);
    return this.getReservation(id);
  }

  getOwnedReservationSessionTarget(
    ownerId: string,
    reservationId: string,
  ): { branchId: string; conversationId: string } | null {
    const row = this.db.prepare(`SELECT r.branch_id, r.conversation_id
      FROM send_reservations r
      JOIN branches b ON b.id = r.branch_id
      JOIN canvases c ON c.id = b.canvas_id
      WHERE r.id = ? AND c.owner_id = ?`).get(reservationId, ownerId) as SqlRow | undefined;
    return row
      ? { branchId: asString(row.branch_id), conversationId: asString(row.conversation_id) }
      : null;
  }

  acknowledgeSend(
    ownerId: string,
    reservationId: string,
    backendTurnId: string | null,
    bootstrapWarnings: string[] = [],
    turnRef: BackendHandle | null = null,
  ): InteractionRecord {
    return this.transaction(() => {
      const row = this.db.prepare(`SELECT r.*, b.canvas_id, b.kind, b.conversation_state, b.head_interaction_id, b.forked_from_interaction_id
        FROM send_reservations r JOIN branches b ON b.id = r.branch_id JOIN canvases c ON c.id = b.canvas_id
        WHERE r.id = ? AND c.owner_id = ?`).get(reservationId, ownerId) as SqlRow | undefined;
      if (!row) throw new Error('not_found');
      if (asString(row.status) === 'acknowledged') {
        const existing = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(asString(row.interaction_id)) as SqlRow;
        return this.hydrateInteraction(mapInteraction(existing));
      }
      if (asString(row.status) !== 'prepared') throw new Error('reservation_not_prepared');

      const currentHead = asNullableString(row.head_interaction_id);
      const expectedHead = asNullableString(row.expected_head_interaction_id);
      if (expectedHead !== currentHead) throw new Error('invalid_branch_transition');
      const parentId = currentHead || asNullableString(row.forked_from_interaction_id);
      const id = randomUUID();
      const now = Date.now();
      this.db.prepare(`INSERT INTO interactions
        (id, branch_id, parent_interaction_id, backend_turn_id, turn_ref_json, user_input,
          status, attachments_json, execution_metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'streaming', ?, ?, ?, ?)`)
        .run(id, asString(row.branch_id), parentId, backendTurnId, turnRef ? JSON.stringify(turnRef) : null,
          asString(row.user_input), asString(row.attachments_json), JSON.stringify({
          materialization: row.materialization,
          conversationId: row.conversation_id,
          ...(bootstrapWarnings.length ? { bootstrapWarnings } : {}),
        }), now, now);
      this.db.prepare(`UPDATE branches SET conversation_state = 'active', head_interaction_id = ?,
        conversation_instance_id = CASE WHEN ? = 'session-recovery' THEN observed_conversation_instance_id ELSE conversation_instance_id END,
        conversation_started_at = CASE WHEN ? = 'session-recovery'
          THEN observed_conversation_started_at ELSE conversation_started_at END,
        conversation_integrity = CASE WHEN ? = 'session-recovery' AND observed_conversation_instance_id IS NOT NULL THEN 'healthy'
          WHEN ? = 'session-recovery' THEN 'unknown' ELSE conversation_integrity END,
        updated_at = ? WHERE id = ?`)
        .run(
          id,
          asString(row.materialization),
          asString(row.materialization),
          asString(row.materialization),
          asString(row.materialization),
          now,
          asString(row.branch_id),
        );
      this.db.prepare(`UPDATE send_reservations SET status = 'acknowledged', dispatch_state = 'acknowledged',
        backend_turn_id = ?, dispatch_recovery_ref_json = ?, interaction_id = ?, next_attempt_at = NULL,
        error = NULL, updated_at = ? WHERE id = ?`)
        .run(backendTurnId, turnRef ? JSON.stringify(turnRef) : null, id, now, reservationId);
      this.db.prepare('UPDATE canvases SET updated_at = ? WHERE id = ?').run(now, asString(row.canvas_id));
      return this.hydrateInteraction(mapInteraction(this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(id) as SqlRow));
    });
  }

  failReservation(ownerId: string, reservationId: string, error: string): boolean {
    const result = this.db.prepare(`UPDATE send_reservations SET status = 'failed', dispatch_state = 'failed',
      error = ?, next_attempt_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'prepared' AND branch_id IN (
        SELECT b.id FROM branches b JOIN canvases c ON c.id = b.canvas_id WHERE c.owner_id = ?
      )`).run(error, Date.now(), reservationId, ownerId);
    return Number(result.changes) > 0;
  }

  failReservationById(reservationId: string, error: string): boolean {
    const result = this.db.prepare(`UPDATE send_reservations SET status = 'failed', dispatch_state = 'failed',
      error = ?, next_attempt_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'prepared'`).run(error, Date.now(), reservationId);
    return Number(result.changes) > 0;
  }

  recordCanvasAttachment(ownerId: string, canvasId: string, attachment: CanvasAttachment): CanvasAttachment {
    if (!attachment.id) throw new Error('attachment_id_required');
    const canvas = this.getCanvas(ownerId, canvasId);
    if (!canvas) throw new Error('not_found');
    const now = Date.now();
    this.db.prepare(`INSERT INTO canvas_attachments
      (canvas_id, attachment_id, content_hash, name, mime_type, size_bytes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(canvas_id, attachment_id) DO UPDATE SET
        content_hash = COALESCE(excluded.content_hash, canvas_attachments.content_hash),
        name = excluded.name,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        updated_at = excluded.updated_at`)
      .run(
        canvasId,
        attachment.id,
        attachment.contentHash || null,
        attachment.name,
        attachment.mimeType,
        attachment.sizeBytes,
        now,
        now,
      );
    return attachment;
  }

  getOwnedCanvasAttachments(ownerId: string, canvasId: string, attachmentIds: string[]): CanvasAttachment[] {
    if (attachmentIds.length === 0) return [];
    if (!this.getCanvas(ownerId, canvasId)) return [];
    const result: CanvasAttachment[] = [];
    const statement = this.db.prepare(`SELECT * FROM canvas_attachments
      WHERE canvas_id = ? AND attachment_id = ?`);
    for (const attachmentId of attachmentIds) {
      const row = statement.get(canvasId, attachmentId) as SqlRow | undefined;
      if (!row) continue;
      result.push({
        id: asString(row.attachment_id),
        ...(asNullableString(row.content_hash) ? { contentHash: asString(row.content_hash) } : {}),
        name: asString(row.name),
        mimeType: asString(row.mime_type),
        sizeBytes: asNumber(row.size_bytes),
        uri: `/api/canvas/attachments/${encodeURIComponent(canvasId)}/${encodeURIComponent(attachmentId)}`,
        storage: 'canvas',
        available: true,
      });
    }
    return result;
  }

  setCanvasAttachmentContentHash(
    ownerId: string,
    canvasId: string,
    attachmentId: string,
    contentHash: string,
  ): boolean {
    if (!/^[a-f0-9]{64}$/.test(contentHash) || !this.getCanvas(ownerId, canvasId)) return false;
    const result = this.db.prepare(`UPDATE canvas_attachments
      SET content_hash = ?, updated_at = ?
      WHERE canvas_id = ? AND attachment_id = ?`)
      .run(contentHash, Date.now(), canvasId, attachmentId);
    return Number(result.changes) > 0;
  }

  setInteractionArtifactContentHash(
    ownerId: string,
    interactionId: string,
    artifactId: string,
    contentHash: string,
  ): boolean {
    if (!/^[a-f0-9]{64}$/.test(contentHash) || !this.getOwnedInteraction(ownerId, interactionId)) return false;
    const result = this.db.prepare(`UPDATE interaction_artifacts
      SET content_hash = ?, updated_at = ?
      WHERE interaction_id = ? AND id = ?`)
      .run(contentHash, Date.now(), interactionId, artifactId);
    return Number(result.changes) > 0;
  }

  getCanvasMediaDerivative(
    canvasId: string,
    sourceContentHash: string,
    purpose: CanvasMediaDerivativePurpose,
    policyVersion: string,
  ): CanvasMediaDerivative | null {
    const row = this.db.prepare(`SELECT * FROM canvas_media_derivatives
      WHERE canvas_id = ? AND source_content_hash = ? AND purpose = ? AND policy_version = ?`)
      .get(canvasId, sourceContentHash, purpose, policyVersion) as SqlRow | undefined;
    return row ? {
      canvasId: asString(row.canvas_id),
      sourceContentHash: asString(row.source_content_hash),
      purpose: asString(row.purpose) as CanvasMediaDerivativePurpose,
      policyVersion: asString(row.policy_version),
      derivativeId: asString(row.derivative_id),
      mimeType: asString(row.mime_type),
      sizeBytes: asNumber(row.size_bytes),
      width: asNumber(row.width),
      height: asNumber(row.height),
      createdAt: asNumber(row.created_at),
      updatedAt: asNumber(row.updated_at),
    } : null;
  }

  recordCanvasMediaDerivative(input: Omit<CanvasMediaDerivative, 'createdAt' | 'updatedAt'>): CanvasMediaDerivative {
    if (!/^[a-f0-9]{64}$/.test(input.sourceContentHash)) throw new Error('invalid_media_content_hash');
    if (!/^[a-f0-9]{40}$/.test(input.derivativeId)) throw new Error('invalid_media_derivative_id');
    const now = Date.now();
    this.db.prepare(`INSERT INTO canvas_media_derivatives
      (canvas_id, source_content_hash, purpose, policy_version, derivative_id,
        mime_type, size_bytes, width, height, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(canvas_id, source_content_hash, purpose, policy_version) DO UPDATE SET
        derivative_id = excluded.derivative_id,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        width = excluded.width,
        height = excluded.height,
        updated_at = excluded.updated_at`)
      .run(
        input.canvasId,
        input.sourceContentHash,
        input.purpose,
        input.policyVersion,
        input.derivativeId,
        input.mimeType,
        input.sizeBytes,
        input.width,
        input.height,
        now,
        now,
      );
    return this.getCanvasMediaDerivative(
      input.canvasId,
      input.sourceContentHash,
      input.purpose,
      input.policyVersion,
    )!;
  }

  listCanvasMediaBackfillSources(): CanvasMediaBackfillSource[] {
    const attachments = this.db.prepare(`SELECT
        'attachment' AS kind, c.owner_id, a.canvas_id, NULL AS interaction_id,
        a.attachment_id AS source_id, a.name, a.mime_type, a.content_hash
      FROM canvas_attachments a
      JOIN canvases c ON c.id = a.canvas_id
      ORDER BY a.canvas_id, a.attachment_id`).all() as SqlRow[];
    const artifacts = this.db.prepare(`SELECT
        'artifact' AS kind, c.owner_id, b.canvas_id, ia.interaction_id,
        ia.id AS source_id, ia.name, COALESCE(ia.mime_type, '') AS mime_type,
        ia.content_hash
      FROM interaction_artifacts ia
      JOIN interactions i ON i.id = ia.interaction_id
      JOIN branches b ON b.id = i.branch_id
      JOIN canvases c ON c.id = b.canvas_id
      WHERE ia.storage = 'canvas' AND ia.available = 1
      ORDER BY b.canvas_id, ia.interaction_id, ia.ordinal`).all() as SqlRow[];
    return [...attachments, ...artifacts].map((row) => ({
      kind: asString(row.kind) as CanvasMediaBackfillSource['kind'],
      ownerId: asString(row.owner_id),
      canvasId: asString(row.canvas_id),
      ...(asNullableString(row.interaction_id) ? { interactionId: asString(row.interaction_id) } : {}),
      sourceId: asString(row.source_id),
      name: asString(row.name),
      mimeType: asString(row.mime_type),
      ...(asNullableString(row.content_hash) ? { contentHash: asString(row.content_hash) } : {}),
    }));
  }

  getOwnedCanvasAttachment(ownerId: string, canvasId: string, attachmentId: string): CanvasAttachment | null {
    const registered = this.getOwnedCanvasAttachments(ownerId, canvasId, [attachmentId])[0];
    if (registered) return registered;
    const row = this.db.prepare(`SELECT attachment.value AS attachment_json
      FROM interactions i
      JOIN branches b ON b.id = i.branch_id
      JOIN canvases c ON c.id = b.canvas_id
      JOIN json_each(i.attachments_json) AS attachment
      WHERE c.owner_id = ? AND c.id = ? AND json_extract(attachment.value, '$.id') = ?
      LIMIT 1`).get(ownerId, canvasId, attachmentId) as SqlRow | undefined;
    return row ? parseJson<CanvasAttachment>(row.attachment_json, {} as CanvasAttachment) : null;
  }

  getOwnedInteraction(ownerId: string, interactionId: string): OwnedInteractionRecord | null {
    const row = this.db.prepare(`SELECT i.*, b.canvas_id, b.conversation_id, b.conversation_ref_json,
        b.conversation_instance_id, b.observed_conversation_instance_id, b.conversation_integrity,
        c.owner_id, c.agent_profile_id, c.backend_id, c.agent_profile_id
      FROM interactions i JOIN branches b ON b.id = i.branch_id JOIN canvases c ON c.id = b.canvas_id
      WHERE i.id = ? AND c.owner_id = ?`).get(interactionId, ownerId) as SqlRow | undefined;
    return row ? this.hydrateOwnedInteraction(mapOwnedInteraction(row)) : null;
  }

  getInteractionForReconciliation(interactionId: string): OwnedInteractionRecord | null {
    const row = this.db.prepare(`SELECT i.*, b.canvas_id, b.conversation_id, b.conversation_ref_json,
        b.conversation_instance_id, b.observed_conversation_instance_id, b.conversation_integrity,
        c.owner_id, c.agent_profile_id, c.backend_id, c.agent_profile_id
      FROM interactions i JOIN branches b ON b.id = i.branch_id JOIN canvases c ON c.id = b.canvas_id
      WHERE i.id = ?`).get(interactionId) as SqlRow | undefined;
    return row ? this.hydrateOwnedInteraction(mapOwnedInteraction(row)) : null;
  }

  listReconciliationCandidates(limit = 500, offset = 0): OwnedInteractionRecord[] {
    const rows = this.db.prepare(`SELECT i.*, b.canvas_id, b.conversation_id, b.conversation_ref_json,
        b.conversation_instance_id, b.observed_conversation_instance_id, b.conversation_integrity,
        c.owner_id, c.agent_profile_id, c.backend_id, c.agent_profile_id
      FROM interactions i JOIN branches b ON b.id = i.branch_id JOIN canvases c ON c.id = b.canvas_id
      WHERE i.execution_state IN ('running', 'unconfirmed')
         OR EXISTS (
           SELECT 1 FROM artifact_sync_jobs j
           WHERE j.interaction_id = i.id AND j.state = 'observing'
         )
      ORDER BY i.updated_at ASC, i.id ASC LIMIT ? OFFSET ?`).all(limit, offset) as SqlRow[];
    return rows.map((row) => this.hydrateOwnedInteraction(mapOwnedInteraction(row)));
  }

  hasArtifactSyncJob(interactionId: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM artifact_sync_jobs
      WHERE interaction_id = ? AND state = 'observing'`).get(interactionId));
  }

  scheduleArtifactSyncAttempt(interactionId: string, nextAttemptAt: number): void {
    const now = Date.now();
    this.db.prepare(`INSERT INTO artifact_sync_jobs
      (interaction_id, state, attempt_count, next_attempt_at, last_error, updated_at)
      VALUES (?, 'observing', 0, ?, NULL, ?)
      ON CONFLICT(interaction_id) DO UPDATE SET
        state = 'observing',
        next_attempt_at = excluded.next_attempt_at,
        updated_at = excluded.updated_at`)
      .run(interactionId, nextAttemptAt, now);
  }

  markArtifactSyncAttempt(interactionId: string): void {
    this.db.prepare(`UPDATE artifact_sync_jobs
      SET attempt_count = attempt_count + 1, next_attempt_at = NULL, updated_at = ?
      WHERE interaction_id = ?`)
      .run(Date.now(), interactionId);
  }

  updateReconciliationMetadata(interactionId: string, patch: Record<string, unknown>): InteractionRecord | null {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(interactionId) as SqlRow | undefined;
      if (!row) return null;
      const metadata = parseJson<Record<string, unknown>>(row.execution_metadata_json, {});
      const previous = metadata.reconciliation && typeof metadata.reconciliation === 'object'
        ? metadata.reconciliation as Record<string, unknown>
        : {};
      const nextMetadata = { ...metadata, reconciliation: { ...previous, ...patch } };
      const now = Date.now();
      this.db.prepare('UPDATE interactions SET execution_metadata_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(nextMetadata), now, interactionId);
      const updated = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(interactionId) as SqlRow;
      return this.hydrateInteraction(mapInteraction(updated));
    });
  }

  updateInteractionCoordination(interactionId: string, input: {
    executionState?: InteractionExecutionState;
    artifactSyncState?: ArtifactSyncState;
    artifactObservationPending?: boolean;
    terminalAt?: number | null;
    error?: string | null;
    nextAttemptAt?: number | null;
  }): InteractionRecord | null {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(interactionId) as SqlRow | undefined;
      if (!row) return null;
      const executionState = input.executionState
        || (asString(row.execution_state) as InteractionExecutionState);
      const artifactSyncState = input.artifactSyncState
        || (asString(row.artifact_sync_state) as ArtifactSyncState);
      const artifactObservationPending = input.artifactObservationPending
        ?? artifactSyncState === 'observing';
      const terminalAt = input.terminalAt === undefined
        ? (row.terminal_at == null ? null : asNumber(row.terminal_at))
        : input.terminalAt;
      const error = input.error === undefined ? asNullableString(row.error) : input.error;
      const now = Date.now();
      const visibleChanged = executionState !== asString(row.execution_state)
        || artifactSyncState !== asString(row.artifact_sync_state)
        || terminalAt !== (row.terminal_at == null ? null : asNumber(row.terminal_at))
        || error !== asNullableString(row.error);
      if (visibleChanged) {
        this.db.prepare(`UPDATE interactions
          SET execution_state = ?, artifact_sync_state = ?, terminal_at = ?, error = ?, updated_at = ?
          WHERE id = ?`).run(executionState, artifactSyncState, terminalAt, error, now, interactionId);
      }
      if (artifactObservationPending) {
        this.db.prepare(`INSERT INTO artifact_sync_jobs
          (interaction_id, state, attempt_count, next_attempt_at, last_error, updated_at)
          VALUES (?, 'observing', 0, ?, ?, ?)
          ON CONFLICT(interaction_id) DO UPDATE SET
            state = 'observing',
            next_attempt_at = excluded.next_attempt_at,
            last_error = excluded.last_error,
            updated_at = excluded.updated_at`)
          .run(interactionId, input.nextAttemptAt ?? null, error, now);
      } else {
        this.db.prepare('DELETE FROM artifact_sync_jobs WHERE interaction_id = ?').run(interactionId);
      }
      const updated = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(interactionId) as SqlRow;
      return this.hydrateInteraction(mapInteraction(updated));
    });
  }

  applyReconciledInteraction(interactionId: string, input: {
    status: 'completed' | 'failed';
    agentOutput: string;
    artifacts: CanvasArtifact[];
    artifactSyncState?: ArtifactSyncState;
    artifactObservationPending?: boolean;
    nextAttemptAt?: number | null;
    terminalAt?: number;
    error?: string | null;
    reconciliation: Record<string, unknown>;
    contextSnapshot?: InteractionContextSnapshot;
  }): InteractionRecord | null {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(interactionId) as SqlRow | undefined;
      if (!row) return null;
      const metadata = parseJson<Record<string, unknown>>(row.execution_metadata_json, {});
      const previous = metadata.reconciliation && typeof metadata.reconciliation === 'object'
        ? metadata.reconciliation as Record<string, unknown>
        : {};
      const contextChanged = Boolean(input.contextSnapshot && !metadata.contextSnapshot);
      const nextMetadata = {
        ...metadata,
        ...(contextChanged ? { contextSnapshot: input.contextSnapshot } : {}),
        reconciliation: { ...previous, ...input.reconciliation },
      };
      const reconciliationArtifactSync = input.reconciliation.artifactSync;
      const artifactSyncState = input.artifactSyncState
        || (reconciliationArtifactSync === 'synced' || reconciliationArtifactSync === 'degraded'
          ? reconciliationArtifactSync
          : 'observing');
      const artifactObservationPending = input.artifactObservationPending
        ?? artifactSyncState === 'observing';
      const now = Date.now();
      const terminalAt = input.terminalAt ?? (row.terminal_at == null ? now : asNumber(row.terminal_at));
      const nextError = input.error ?? (input.status === 'failed' ? input.agentOutput || 'Agent Backend turn failed' : null);
      const currentArtifacts = this.listInteractionArtifacts(interactionId);
      const normalizedArtifacts = this.normalizeInteractionArtifacts(interactionId, input.artifacts);
      const artifactsChanged = JSON.stringify(currentArtifacts) !== JSON.stringify(normalizedArtifacts);
      const visibleChanged = input.status !== asString(row.status)
        || input.status !== asString(row.execution_state)
        || artifactSyncState !== asString(row.artifact_sync_state)
        || input.agentOutput !== asString(row.agent_output)
        || terminalAt !== (row.terminal_at == null ? null : asNumber(row.terminal_at))
        || nextError !== asNullableString(row.error)
        || artifactsChanged
        || contextChanged;
      if (visibleChanged) {
        this.db.prepare(`UPDATE interactions
          SET status = ?, execution_state = ?, artifact_sync_state = ?, agent_output = ?,
            terminal_at = ?, error = ?, execution_metadata_json = ?, updated_at = ?
          WHERE id = ?`)
          .run(
            input.status,
            input.status,
            artifactSyncState,
            input.agentOutput,
            terminalAt,
            nextError,
            JSON.stringify(nextMetadata),
            now,
            interactionId,
          );
        if (artifactsChanged) this.replaceInteractionArtifacts(interactionId, normalizedArtifacts, now);
      } else {
        this.db.prepare('UPDATE interactions SET execution_metadata_json = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(nextMetadata), now, interactionId);
      }
      if (artifactObservationPending) {
        this.db.prepare(`INSERT INTO artifact_sync_jobs
          (interaction_id, state, attempt_count, next_attempt_at, last_error, updated_at)
          VALUES (?, 'observing', 0, ?, ?, ?)
          ON CONFLICT(interaction_id) DO UPDATE SET
            state = 'observing',
            next_attempt_at = excluded.next_attempt_at,
            last_error = excluded.last_error,
            updated_at = excluded.updated_at`)
          .run(interactionId, input.nextAttemptAt ?? null, input.error || null, now);
      } else {
        this.db.prepare('DELETE FROM artifact_sync_jobs WHERE interaction_id = ?').run(interactionId);
      }
      const updated = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(interactionId) as SqlRow;
      return this.hydrateInteraction(mapInteraction(updated));
    });
  }

  getCanvasCursor(canvasId: string): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS cursor FROM canvas_changes WHERE canvas_id = ?')
      .get(canvasId) as SqlRow;
    return asNumber(row.cursor);
  }

  getCanvasSyncBatch(ownerId: string, canvasId: string, after: number, limit = 500): CanvasSyncBatch | null {
    const canvas = this.getCanvas(ownerId, canvasId);
    if (!canvas) return null;
    const changes = this.db.prepare(`SELECT seq, entity_type, entity_id, operation
      FROM canvas_changes WHERE canvas_id = ? AND seq > ?
      ORDER BY seq LIMIT ?`).all(canvasId, Math.max(0, after), Math.max(1, limit)) as SqlRow[];
    const latest = new Map<string, SqlRow>();
    for (const change of changes) {
      latest.set(`${asString(change.entity_type)}:${asString(change.entity_id)}`, change);
    }
    const branches: BranchRecord[] = [];
    const interactions: InteractionRecord[] = [];
    const sendOperations: SendReservation[] = [];
    const removed = {
      branchIds: [] as string[],
      interactionIds: [] as string[],
      sendOperationIds: [] as string[],
    };
    let includeCanvas = false;
    for (const change of latest.values()) {
      const type = asString(change.entity_type);
      const id = asString(change.entity_id);
      if (type === 'canvas') {
        includeCanvas = true;
      } else if (type === 'branch') {
        const row = this.db.prepare(`SELECT b.* FROM branches b
          JOIN canvases c ON c.id = b.canvas_id
          WHERE b.id = ? AND b.canvas_id = ? AND c.owner_id = ?`).get(id, canvasId, ownerId) as SqlRow | undefined;
        if (row) branches.push(mapBranch(row));
        else removed.branchIds.push(id);
      } else if (type === 'interaction') {
        const interaction = this.getOwnedInteraction(ownerId, id);
        if (interaction && interaction.canvasId === canvasId) interactions.push(interaction);
        else removed.interactionIds.push(id);
      } else if (type === 'send_operation') {
        const row = this.db.prepare(`SELECT r.id FROM send_reservations r
          JOIN branches b ON b.id = r.branch_id
          JOIN canvases c ON c.id = b.canvas_id
          WHERE r.id = ? AND b.canvas_id = ? AND c.owner_id = ?`).get(id, canvasId, ownerId) as SqlRow | undefined;
        const operation = row ? this.getReservation(id) : null;
        if (operation) sendOperations.push(operation);
        else removed.sendOperationIds.push(id);
      }
    }
    return {
      cursor: changes.length ? asNumber(changes[changes.length - 1].seq) : this.getCanvasCursor(canvasId),
      ...(includeCanvas ? { canvas: this.getCanvas(ownerId, canvasId) || undefined } : {}),
      branches,
      interactions,
      sendOperations,
      removed,
    };
  }

  findInteractionByBackendCorrelation(
    backendId: string,
    turnRef: BackendHandle | null,
    conversationRef: BackendHandle | null,
  ): OwnedInteractionRecord | null {
    if (turnRef) {
      const row = this.db.prepare(`SELECT i.*, b.canvas_id, b.conversation_id, b.conversation_ref_json,
          b.conversation_instance_id, b.observed_conversation_instance_id, b.conversation_integrity,
          c.owner_id, c.agent_profile_id, c.backend_id, c.agent_profile_id
        FROM interactions i
        JOIN branches b ON b.id = i.branch_id
        JOIN canvases c ON c.id = b.canvas_id
        WHERE c.backend_id = ? AND i.turn_ref_json = ?
          AND i.execution_state IN ('running', 'unconfirmed')
        ORDER BY i.created_at DESC LIMIT 1`).get(backendId, JSON.stringify(turnRef)) as SqlRow | undefined;
      if (row) return this.hydrateOwnedInteraction(mapOwnedInteraction(row));
    }
    if (!conversationRef) return null;
    const rows = this.db.prepare(`SELECT i.*, b.canvas_id, b.conversation_id, b.conversation_ref_json,
        b.conversation_instance_id, b.observed_conversation_instance_id, b.conversation_integrity,
        c.owner_id, c.agent_profile_id, c.backend_id, c.agent_profile_id
      FROM interactions i
      JOIN branches b ON b.id = i.branch_id
      JOIN canvases c ON c.id = b.canvas_id
      WHERE c.backend_id = ? AND b.conversation_ref_json = ?
        AND i.execution_state IN ('running', 'unconfirmed')
      ORDER BY i.created_at DESC LIMIT 2`).all(backendId, JSON.stringify(conversationRef)) as SqlRow[];
    return rows.length === 1 ? this.hydrateOwnedInteraction(mapOwnedInteraction(rows[0])) : null;
  }

  recordInteractionApproval(
    interactionId: string,
    backendId: string,
    approvalRef: BackendHandle,
    approval: ApprovalSummary,
    createdAt = Date.now(),
  ): InteractionApprovalRecord | null {
    const id = randomUUID();
    this.db.prepare(`INSERT OR IGNORE INTO interaction_approvals
      (id, interaction_id, backend_id, approval_ref_json, category, title, description,
        risk, permissions_json, choices_json, expires_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).run(
      id,
      interactionId,
      backendId,
      JSON.stringify(approvalRef),
      approval.category,
      approval.title,
      approval.description || null,
      approval.risk,
      JSON.stringify(approval.permissions),
      JSON.stringify(approval.choices),
      approval.expiresAt || null,
      createdAt,
      createdAt,
    );
    const row = this.db.prepare(`SELECT * FROM interaction_approvals
      WHERE backend_id = ? AND approval_ref_json = ?`)
      .get(backendId, JSON.stringify(approvalRef)) as SqlRow | undefined;
    return row ? mapInteractionApproval(row) : null;
  }

  applyInteractionApprovalResolution(
    backendId: string,
    approvalRef: BackendHandle,
    resolution: ApprovalResolution,
    resolvedBy?: string,
  ): InteractionApprovalRecord | null {
    const row = this.db.prepare(`SELECT * FROM interaction_approvals
      WHERE backend_id = ? AND approval_ref_json = ?`)
      .get(backendId, JSON.stringify(approvalRef)) as SqlRow | undefined;
    if (!row) return null;
    const approval = mapInteractionApproval(row);
    const choice = approval.choices.find((candidate) => candidate.id === resolution.choiceId);
    const status: InteractionApprovalStatus = choice?.intent === 'deny' ? 'denied' : 'resolved';
    const now = Date.now();
    this.db.prepare(`UPDATE interaction_approvals SET status = ?, resolution_json = ?,
      resolved_by = ?, resolved_at = ?, error = NULL, updated_at = ? WHERE id = ?`).run(
      status,
      JSON.stringify(resolution),
      resolvedBy || null,
      now,
      now,
      approval.id,
    );
    return mapInteractionApproval(this.db.prepare('SELECT * FROM interaction_approvals WHERE id = ?').get(approval.id) as SqlRow);
  }

  getOwnedInteractionApproval(ownerId: string, approvalId: string): InteractionApprovalRecord | null {
    const row = this.db.prepare(`SELECT a.* FROM interaction_approvals a
      JOIN interactions i ON i.id = a.interaction_id
      JOIN branches b ON b.id = i.branch_id
      JOIN canvases c ON c.id = b.canvas_id
      WHERE a.id = ? AND c.owner_id = ?`).get(approvalId, ownerId) as SqlRow | undefined;
    return row ? mapInteractionApproval(row) : null;
  }

  claimInteractionApproval(
    ownerId: string,
    approvalId: string,
    resolution: ApprovalResolution,
  ): InteractionApprovalRecord {
    return this.transaction(() => {
      const approval = this.getOwnedInteractionApproval(ownerId, approvalId);
      if (!approval) throw new Error('not_found');
      if (approval.status !== 'pending') throw new Error('approval_not_pending');
      if (approval.expiresAt !== null && approval.expiresAt <= Date.now()) {
        this.db.prepare(`UPDATE interaction_approvals SET status = 'expired', updated_at = ? WHERE id = ?`)
          .run(Date.now(), approval.id);
        throw new Error('approval_expired');
      }
      const choice = approval.choices.find((candidate) => candidate.id === resolution.choiceId);
      if (!choice) throw new Error('approval_choice_invalid');
      const requested = new Set(approval.permissions.map((permission) => permission.id));
      const granted = resolution.grantedPermissionIds || (choice.intent === 'grant' ? [...requested] : []);
      if (granted.some((permissionId) => !requested.has(permissionId))) {
        throw new Error('approval_permissions_invalid');
      }
      if (choice.intent === 'deny' && granted.length > 0) throw new Error('approval_permissions_invalid');
      const normalized = { ...resolution, ...(granted.length ? { grantedPermissionIds: granted } : {}) };
      this.db.prepare(`UPDATE interaction_approvals SET status = 'resolving', resolution_json = ?,
        error = NULL, updated_at = ? WHERE id = ? AND status = 'pending'`)
        .run(JSON.stringify(normalized), Date.now(), approval.id);
      return mapInteractionApproval(this.db.prepare('SELECT * FROM interaction_approvals WHERE id = ?').get(approval.id) as SqlRow);
    });
  }

  finishInteractionApproval(
    approvalId: string,
    outcome: 'accepted' | 'rejected' | 'unknown',
    error?: string,
  ): InteractionApprovalRecord | null {
    const row = this.db.prepare('SELECT * FROM interaction_approvals WHERE id = ?').get(approvalId) as SqlRow | undefined;
    if (!row) return null;
    const approval = mapInteractionApproval(row);
    const choice = approval.resolution
      ? approval.choices.find((candidate) => candidate.id === approval.resolution?.choiceId)
      : null;
    const status: InteractionApprovalStatus = outcome === 'accepted'
      ? choice?.intent === 'deny' ? 'denied' : 'resolved'
      : outcome === 'unknown' ? 'unconfirmed' : 'pending';
    const now = Date.now();
    this.db.prepare(`UPDATE interaction_approvals SET status = ?,
      resolved_by = CASE WHEN ? = 'accepted' THEN 'user' ELSE resolved_by END,
      resolved_at = CASE WHEN ? = 'accepted' THEN ? ELSE resolved_at END,
      error = ?, updated_at = ? WHERE id = ?`).run(
      status,
      outcome,
      outcome,
      now,
      error || null,
      now,
      approvalId,
    );
    return mapInteractionApproval(this.db.prepare('SELECT * FROM interaction_approvals WHERE id = ?').get(approvalId) as SqlRow);
  }

  recordBackendEvent(input: StoredBackendEvent): boolean {
    const result = this.db.prepare(`INSERT OR IGNORE INTO backend_event_inbox
      (event_key, backend_id, conversation_ref_json, turn_ref_json, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      input.eventKey,
      input.backendId,
      input.conversationRef ? JSON.stringify(input.conversationRef) : null,
      input.turnRef ? JSON.stringify(input.turnRef) : null,
      input.event.type,
      JSON.stringify(input.event),
      input.createdAt,
    );
    return Number(result.changes) > 0;
  }

  listPendingBackendEvents(
    backendId: string,
    turnRef: BackendHandle | null,
    conversationRef: BackendHandle,
  ): StoredBackendEvent[] {
    const turnJson = turnRef ? JSON.stringify(turnRef) : '';
    const conversationJson = JSON.stringify(conversationRef);
    const rows = this.db.prepare(`SELECT * FROM backend_event_inbox
      WHERE backend_id = ? AND processed_at IS NULL
        AND ((? != '' AND turn_ref_json = ?) OR conversation_ref_json = ?)
      ORDER BY created_at, event_key`).all(backendId, turnJson, turnJson, conversationJson) as SqlRow[];
    return rows.flatMap((row) => {
      const event = parseJson<BackendEvent | null>(row.payload_json, null);
      if (!event) return [];
      return [{
        eventKey: asString(row.event_key),
        backendId: asString(row.backend_id),
        conversationRef: parseBackendHandle(row.conversation_ref_json),
        turnRef: parseBackendHandle(row.turn_ref_json),
        event,
        createdAt: asNumber(row.created_at),
      }];
    });
  }

  markBackendEventProcessed(eventKey: string): void {
    this.db.prepare(`UPDATE backend_event_inbox SET processed_at = ?
      WHERE event_key = ? AND processed_at IS NULL`).run(Date.now(), eventKey);
  }

  getGraph(ownerId: string, canvasId: string): CanvasGraph | null {
    const canvas = this.getCanvas(ownerId, canvasId);
    if (!canvas) return null;
    const branches = (this.db.prepare('SELECT * FROM branches WHERE canvas_id = ? ORDER BY created_at').all(canvasId) as SqlRow[]).map(mapBranch);
    const interactions = (this.db.prepare(`SELECT i.* FROM interactions i JOIN branches b ON b.id = i.branch_id
      WHERE b.canvas_id = ? ORDER BY i.created_at`).all(canvasId) as SqlRow[])
      .map((row) => this.hydrateInteraction(mapInteraction(row)));
    const layoutRow = this.db.prepare('SELECT layout_json FROM canvas_layouts WHERE canvas_id = ?').get(canvasId) as SqlRow | undefined;
    const pendingRows = this.db.prepare(`SELECT r.id FROM send_reservations r
      JOIN branches b ON b.id = r.branch_id
      WHERE b.canvas_id = ? AND r.status = 'prepared'
      ORDER BY r.created_at`).all(canvasId) as SqlRow[];
    const pendingSends = pendingRows.flatMap((row) => {
      const reservation = this.getReservation(asString(row.id));
      return reservation ? [reservation] : [];
    });
    const failedRows = this.db.prepare(`SELECT r.id
      FROM send_reservations r
      JOIN branches b ON b.id = r.branch_id
      WHERE b.canvas_id = ?
        AND b.conversation_state = 'draft'
        AND r.status = 'failed'
        AND r.rowid = (
          SELECT newer.rowid FROM send_reservations newer
          WHERE newer.branch_id = r.branch_id
          ORDER BY newer.created_at DESC, newer.rowid DESC
          LIMIT 1
        )
      ORDER BY r.created_at`).all(canvasId) as SqlRow[];
    const failedSends = failedRows.flatMap((row) => {
      const reservation = this.getReservation(asString(row.id));
      return reservation ? [reservation] : [];
    });
    return {
      cursor: this.getCanvasCursor(canvasId),
      canvas,
      branches,
      interactions,
      layout: layoutRow ? parseJson(rowValue(layoutRow, 'layout_json'), null) : null,
      pendingSends,
      failedSends,
    };
  }

  saveLayout(ownerId: string, canvasId: string, layout: CanvasGraph['layout']): boolean {
    if (!this.getCanvas(ownerId, canvasId) || !layout) return false;
    this.db.prepare(`INSERT INTO canvas_layouts(canvas_id, layout_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(canvas_id) DO UPDATE SET layout_json = excluded.layout_json, updated_at = excluded.updated_at`)
      .run(canvasId, JSON.stringify(layout), Date.now());
    return true;
  }
}

function rowValue(row: SqlRow, key: string): unknown {
  return row[key];
}

let store: CanvasStore | null = null;

export function getCanvasStore(): CanvasStore {
  store ||= new CanvasStore();
  return store;
}

export function resetCanvasStoreForTests(): void {
  store?.close();
  store = null;
}
