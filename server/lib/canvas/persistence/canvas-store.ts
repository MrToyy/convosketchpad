import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type RuntimeEvent,
  type RuntimeHandle,
  type AgentProfileRef,
  type ApprovalChoice,
  type ApprovalPermission,
  type ApprovalResolution,
  type ApprovalSummary,
} from '../../agent-runtimes/contract.js';
import type { ConversationHandleFactory } from '../application/ports.js';
import type {
  ArtifactSyncState,
  BranchConversationIntegrity,
  BranchConversationLifecycle,
  BranchConversationState,
  BranchCreationMode,
  BranchKind,
  BranchRecord,
  BranchRuntimeContext,
  CanvasArtifact,
  CanvasAttachment,
  CanvasGraph,
  CanvasMediaBackfillSource,
  CanvasMediaDerivative,
  CanvasMediaDerivativePurpose,
  CanvasRecord,
  CanvasSyncBatch,
  CanvasUserRecord,
  CanvasUserStatus,
  DispatchableSendReservation,
  InteractionApprovalRecord,
  InteractionApprovalStatus,
  InteractionContextSnapshot,
  InteractionExecutionState,
  InteractionRecord,
  InteractionStatus,
  MergeSourceRecord,
  OwnedInteractionApprovalResolution,
  OwnedInteractionRecord,
  SendReservation,
  StoredRuntimeEvent,
} from '../model.js';
import type {
  MergeContextInteraction,
  MergeContextSnapshot,
} from '../domain/merge-context.js';
import {
  decideCanvasSendPlan,
  type CanonicalCanvasSnapshot,
  type CanvasContextResource,
  type SendDispatchState,
  type SendMaterialization,
} from '../domain/send-policy.js';
import { assembleCanonicalCanvasSnapshot } from '../domain/history-snapshot.js';
import { compileCanvasTurnMaterials } from '../domain/turn-material-compiler.js';
import {
  normalizeCanvasInputDocument,
  textInputDocument,
  type CanvasInputDocument,
  type CanvasResourceReferenceSnapshot,
} from '../domain/input-document.js';
import { config } from '../../config.js';
import { applySingleChainSchemaMigration } from './migrations/v020-to-v030.js';
import { packageMetadata } from '../../package-metadata.js';
import {
  createCurrentCanvasSchema,
  ensureGenericAgentRuntimeSchema,
} from './agent-runtime-schema.js';
import { ensureResourceReferenceSchema } from './resource-reference-schema.js';
import { ensureBranchMergingSchema } from './branch-merging-schema.js';

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

function parseRuntimeHandle(value: unknown): RuntimeHandle | null {
  const handle = parseJson<RuntimeHandle | null>(value, null);
  if (!handle || typeof handle !== 'object' || Array.isArray(handle)) return null;
  if (typeof handle.runtimeId !== 'string' || !handle.runtimeId) return null;
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
    || snapshot.usedTokens > snapshot.contextLimit
    || typeof snapshot.conversationInstanceId !== 'string'
    || !snapshot.conversationInstanceId
    || typeof snapshot.capturedAt !== 'number'
    || !Number.isFinite(snapshot.capturedAt)
    || snapshot.source !== 'agent-runtime'
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
      runtimeId: asString(row.runtime_id),
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

function mapMergeSource(row: SqlRow): MergeSourceRecord {
  return {
    id: asString(row.id),
    targetBranchId: asString(row.target_branch_id),
    expectedHeadInteractionId: asNullableString(row.expected_head_interaction_id),
    sourceInteractionId: asString(row.source_interaction_id),
    targetInteractionId: asNullableString(row.target_interaction_id),
    ordinal: asNumber(row.ordinal),
    createdAt: asNumber(row.created_at),
  };
}

function mapInteraction(row: SqlRow): InteractionRecord {
  const executionMetadata = parseJson<Record<string, unknown>>(row.execution_metadata_json, {});
  const contextSnapshot = parseInteractionContextSnapshot(executionMetadata.contextSnapshot);
  const runtimeTurnId = asNullableString(row.runtime_turn_id);
  const userInput = asString(row.user_input);
  return {
    id: asString(row.id),
    version: Math.max(1, asNumber(row.version) || 1),
    branchId: asString(row.branch_id),
    parentInteractionId: asNullableString(row.parent_interaction_id),
    runtimeTurnId,
    turnRef: parseRuntimeHandle(row.turn_ref_json),
    userInput,
    inputDocument: parseJson<CanvasInputDocument>(row.input_document_json, textInputDocument(userInput)),
    resourceReferences: [],
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
  const approvalRef = parseRuntimeHandle(row.approval_ref_json);
  if (!approvalRef) throw new Error('Stored approval has an invalid Runtime handle');
  return {
    id: asString(row.id),
    interactionId: asString(row.interaction_id),
    runtimeId: asString(row.runtime_id),
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
    runtimeId: asString(row.runtime_id),
    agentProfileId: asString(row.agent_profile_id),
    conversationRef: parseRuntimeHandle(row.conversation_ref_json) || undefined,
    conversationInstanceId: asNullableString(row.conversation_instance_id),
    observedConversationInstanceId: asNullableString(row.observed_conversation_instance_id),
    conversationIntegrity: (asString(row.conversation_integrity) || 'unknown') as BranchConversationIntegrity,
  };
}

export class CanvasStore {
  readonly db: DatabaseSync;
  private readonly createConversationHandle?: ConversationHandleFactory;

  constructor(
    databasePath = config.canvasDatabasePath,
    dependencies: { createConversationHandle?: ConversationHandleFactory } = {},
  ) {
    this.createConversationHandle = dependencies.createConversationHandle;
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private conversationHandle(profile: AgentProfileRef, localConversationId: string): RuntimeHandle {
    if (!this.createConversationHandle) {
      throw new Error('conversation_handle_factory_not_configured');
    }
    return this.createConversationHandle({ profile, localConversationId });
  }

  private migrate(): void {
    const existingCanvasColumns = this.db.prepare('PRAGMA table_info(canvases)').all() as SqlRow[];
    if (existingCanvasColumns.length === 0) {
      createCurrentCanvasSchema(this.db, packageMetadata.version);
      ensureBranchMergingSchema(this.db, packageMetadata.version);
      return;
    }
    if (
      !existingCanvasColumns.some((column) => asString(column.name) === 'agent_id')
    ) {
      ensureGenericAgentRuntimeSchema(this.db, packageMetadata.version);
      ensureResourceReferenceSchema(this.db, packageMetadata.version);
      ensureBranchMergingSchema(this.db, packageMetadata.version);
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
        runtime_id TEXT NOT NULL DEFAULT 'openclaw',
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
        runtime_id TEXT NOT NULL DEFAULT 'openclaw',
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
        runtime_artifact_ref_json TEXT,
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
      if (!reservationColumns.some((column) => asString(column.name) === 'runtime_id')) {
        this.db.exec("ALTER TABLE send_reservations ADD COLUMN runtime_id TEXT NOT NULL DEFAULT 'openclaw'");
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
    if (!artifactColumns.some((column) => asString(column.name) === 'runtime_artifact_ref_json')) {
      this.db.exec('ALTER TABLE interaction_artifacts ADD COLUMN runtime_artifact_ref_json TEXT');
    }
    const canvasColumns = this.db.prepare('PRAGMA table_info(canvases)').all() as SqlRow[];
    if (!canvasColumns.some((column) => asString(column.name) === 'runtime_id')) {
      this.db.exec("ALTER TABLE canvases ADD COLUMN runtime_id TEXT NOT NULL DEFAULT 'openclaw'");
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
        UPDATE canvases SET runtime_id = 'openclaw' WHERE runtime_id IS NULL OR runtime_id = '';
        UPDATE canvases SET agent_profile_id = agent_id WHERE agent_profile_id IS NULL OR agent_profile_id = '';
        UPDATE branches SET conversation_ref_json = json_object(
          'runtimeId', 'openclaw', 'schemaVersion', 1,
          'opaque', json_object('sessionKey', session_key)
        ) WHERE conversation_ref_json IS NULL;
        UPDATE branches SET observed_conversation_ref_json = json_object(
          'runtimeId', 'openclaw', 'schemaVersion', 1,
          'opaque', json_object('sessionKey', session_key, 'sessionId', observed_session_id)
        ) WHERE observed_conversation_ref_json IS NULL AND observed_session_id IS NOT NULL;
        UPDATE interactions SET turn_ref_json = json_object(
          'runtimeId', 'openclaw', 'schemaVersion', 1,
          'opaque', json_object('runId', run_id)
        ) WHERE turn_ref_json IS NULL AND run_id IS NOT NULL;
        UPDATE send_reservations SET runtime_id = 'openclaw' WHERE runtime_id IS NULL OR runtime_id = '';
        UPDATE send_reservations SET conversation_ref_json = json_object(
          'runtimeId', 'openclaw', 'schemaVersion', 1,
          'opaque', json_object('sessionKey', session_key)
        ) WHERE conversation_ref_json IS NULL;
        UPDATE interaction_artifacts SET runtime_artifact_ref_json = json_object(
          'runtimeId', 'openclaw', 'schemaVersion', 1,
          'opaque', json_object('artifactId', gateway_artifact_id)
        ) WHERE runtime_artifact_ref_json IS NULL AND gateway_artifact_id IS NOT NULL;
      `);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
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
    ensureGenericAgentRuntimeSchema(this.db, packageMetadata.version);
    ensureResourceReferenceSchema(this.db, packageMetadata.version);
    ensureBranchMergingSchema(this.db, packageMetadata.version);
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
      ...(asNullableString(row.runtime_artifact_id) ? { runtimeArtifactId: asString(row.runtime_artifact_id) } : {}),
      ...(parseRuntimeHandle(row.runtime_artifact_ref_json)
        ? { runtimeArtifactRef: parseRuntimeHandle(row.runtime_artifact_ref_json)! }
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
      resourceReferences: this.listTurnResourceReferences('interaction_id', record.id),
    };
  }

  private hydrateOwnedInteraction(record: OwnedInteractionRecord): OwnedInteractionRecord {
    return {
      ...record,
      artifacts: this.listInteractionArtifacts(record.id),
      approvals: this.listInteractionApprovals(record.id),
      resourceReferences: this.listTurnResourceReferences('interaction_id', record.id),
    };
  }

  private listTurnResourceReferences(
    column: 'interaction_id' | 'send_reservation_id',
    id: string,
  ): CanvasResourceReferenceSnapshot[] {
    const rows = this.db.prepare(`SELECT * FROM turn_resource_references
      WHERE ${column} = ? ORDER BY ordinal, reference_key`).all(id) as SqlRow[];
    return rows.map((row) => ({
      key: asString(row.reference_key),
      origin: asString(row.origin) as CanvasResourceReferenceSnapshot['origin'],
      kind: asString(row.resource_kind) as CanvasResourceReferenceSnapshot['kind'],
      sourceInteractionId: asNullableString(row.source_interaction_id),
      resourceId: asString(row.resource_id),
      ordinal: asNumber(row.ordinal),
      name: asString(row.name_snapshot),
      mimeType: asString(row.mime_type_snapshot),
      ...(row.size_bytes_snapshot == null ? {} : { sizeBytes: asNumber(row.size_bytes_snapshot) }),
      uri: asString(row.uri_snapshot),
      available: asNumber(row.available_snapshot) !== 0,
      ...(asNullableString(row.warning_snapshot) ? { warning: asString(row.warning_snapshot) } : {}),
      ...(asNullableString(row.content_hash_snapshot)
        ? { contentHash: asString(row.content_hash_snapshot) }
        : {}),
    }));
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
      ...(artifact.runtimeArtifactId ? { runtimeArtifactId: artifact.runtimeArtifactId } : {}),
      ...(artifact.runtimeArtifactRef ? { runtimeArtifactRef: artifact.runtimeArtifactRef } : {}),
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
      (interaction_id, id, content_hash, runtime_artifact_id, runtime_artifact_ref_json, name, mime_type, size_bytes, uri,
        source_uri, storage, available, warning, ordinal, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.normalizeInteractionArtifacts(interactionId, artifacts).forEach((artifact, index) => {
      insert.run(
        interactionId,
        artifact.id || `${interactionId}:artifact:${index}`,
        artifact.contentHash || null,
        artifact.runtimeArtifactId || null,
        artifact.runtimeArtifactRef ? JSON.stringify(artifact.runtimeArtifactRef) : null,
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
      (id, owner_id, name, runtime_id, agent_profile_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        ownerId,
        name,
        agentRef.runtimeId,
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
        canvas.agentRef.runtimeId === agentRef.runtimeId
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
      this.db.prepare(`UPDATE canvases SET runtime_id = ?, agent_profile_id = ?, updated_at = ?
        WHERE id = ? AND owner_id = ?`)
        .run(agentRef.runtimeId, agentRef.profileId, now, id, ownerId);
      const draftBranches = this.db.prepare(
        "SELECT id FROM branches WHERE canvas_id = ? AND conversation_state = 'draft'",
      ).all(id) as SqlRow[];
      const updateBranch = this.db.prepare(
        `UPDATE branches SET conversation_id = ?, conversation_ref_json = ?, updated_at = ?
          WHERE id = ? AND conversation_state = 'draft'`,
      );
      for (const branch of draftBranches) {
        const branchId = asString(branch.id);
        const conversationRef = this.conversationHandle(agentRef, branchId);
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
    const conversationRef = this.conversationHandle(agentRef, id);
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

  createMergeSource(
    ownerId: string,
    targetBranchId: string,
    expectedHeadInteractionId: string | null,
    sourceInteractionId: string,
  ): { mergeSource: MergeSourceRecord; created: boolean; canvasId: string } {
    return this.transaction(() => {
      const branchRow = this.db.prepare(`SELECT b.*, c.owner_id
        FROM branches b JOIN canvases c ON c.id = b.canvas_id
        WHERE b.id = ? AND c.owner_id = ?`).get(targetBranchId, ownerId) as SqlRow | undefined;
      if (!branchRow) throw new Error('not_found');
      const canvasId = asString(branchRow.canvas_id);
      const currentHead = asNullableString(branchRow.head_interaction_id);
      const conversationState = asString(branchRow.conversation_state);
      if (
        (conversationState === 'draft' && (currentHead !== null || expectedHeadInteractionId !== null))
        || (conversationState === 'active' && currentHead !== expectedHeadInteractionId)
      ) throw new Error('invalid_branch_transition');
      if (conversationState === 'active') {
        const head = this.db.prepare(`SELECT execution_state FROM interactions
          WHERE id = ? AND branch_id = ?`).get(currentHead, targetBranchId) as SqlRow | undefined;
        if (!head || asString(head.execution_state) !== 'completed') {
          throw new Error('invalid_branch_transition');
        }
      }
      const prepared = this.db.prepare(`SELECT 1 FROM send_reservations
        WHERE branch_id = ? AND status = 'prepared'`).get(targetBranchId);
      if (prepared) throw new Error('send_in_progress');

      const source = this.db.prepare(`SELECT i.*, b.canvas_id
        FROM interactions i JOIN branches b ON b.id = i.branch_id
        JOIN canvases c ON c.id = b.canvas_id
        WHERE i.id = ? AND c.owner_id = ?`).get(sourceInteractionId, ownerId) as SqlRow | undefined;
      if (!source || asString(source.canvas_id) !== canvasId) throw new Error('not_found');
      if (asString(source.execution_state) !== 'completed') throw new Error('interaction_not_completed');
      const incomingInteractionId = conversationState === 'draft'
        ? asNullableString(branchRow.forked_from_interaction_id)
        : currentHead;
      if (incomingInteractionId === sourceInteractionId) {
        throw new Error('redundant_merge_source');
      }

      const generationPredicate = expectedHeadInteractionId === null
        ? 'expected_head_interaction_id IS NULL'
        : 'expected_head_interaction_id = ?';
      const generationArgs = expectedHeadInteractionId === null
        ? [targetBranchId]
        : [targetBranchId, expectedHeadInteractionId];
      const existing = this.db.prepare(`SELECT s.*,
          (SELECT t.interaction_id FROM turn_merge_sources t
            WHERE t.composer_merge_source_id = s.id AND t.interaction_id IS NOT NULL
            ORDER BY t.created_at LIMIT 1) AS target_interaction_id
        FROM composer_merge_sources s
        WHERE s.target_branch_id = ? AND ${generationPredicate}
          AND s.source_interaction_id = ?`)
        .get(...generationArgs, sourceInteractionId) as SqlRow | undefined;
      if (existing) return { mergeSource: mapMergeSource(existing), created: false, canvasId };

      const ordinalRow = this.db.prepare(`SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal
        FROM composer_merge_sources
        WHERE target_branch_id = ? AND ${generationPredicate}`)
        .get(...generationArgs) as SqlRow;
      const id = randomUUID();
      const createdAt = Date.now();
      this.db.prepare(`INSERT INTO composer_merge_sources
        (id, target_branch_id, expected_head_interaction_id, source_interaction_id, ordinal, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, targetBranchId, expectedHeadInteractionId, sourceInteractionId, asNumber(ordinalRow.ordinal), createdAt);
      const row = this.db.prepare(`SELECT s.*, NULL AS target_interaction_id
        FROM composer_merge_sources s WHERE id = ?`).get(id) as SqlRow;
      return { mergeSource: mapMergeSource(row), created: true, canvasId };
    });
  }

  listMergeSourcesForGeneration(
    ownerId: string,
    targetBranchId: string,
    expectedHeadInteractionId: string | null,
  ): MergeSourceRecord[] {
    const predicate = expectedHeadInteractionId === null
      ? 's.expected_head_interaction_id IS NULL'
      : 's.expected_head_interaction_id = ?';
    const args = expectedHeadInteractionId === null
      ? [targetBranchId, ownerId]
      : [targetBranchId, expectedHeadInteractionId, ownerId];
    return (this.db.prepare(`SELECT s.*,
        (SELECT t.interaction_id FROM turn_merge_sources t
          WHERE t.composer_merge_source_id = s.id AND t.interaction_id IS NOT NULL
          ORDER BY t.created_at LIMIT 1) AS target_interaction_id
      FROM composer_merge_sources s
      JOIN branches b ON b.id = s.target_branch_id
      JOIN canvases c ON c.id = b.canvas_id
      WHERE s.target_branch_id = ? AND ${predicate} AND c.owner_id = ?
      ORDER BY s.ordinal`).all(...args) as SqlRow[]).map(mapMergeSource);
  }

  getInteractionMergeContextSnapshot(interactionId: string): MergeContextSnapshot | null {
    const row = this.db.prepare(`SELECT merge_context_snapshot_json FROM send_reservations
      WHERE interaction_id = ? AND status = 'acknowledged'
      ORDER BY created_at DESC LIMIT 1`).get(interactionId) as SqlRow | undefined;
    return row ? parseJson<MergeContextSnapshot | null>(row.merge_context_snapshot_json, null) : null;
  }

  listAcceptedMergeSourceInteractionIds(interactionId: string): string[] {
    return (this.db.prepare(`SELECT source_interaction_id FROM turn_merge_sources
      WHERE interaction_id = ? ORDER BY ordinal`).all(interactionId) as SqlRow[])
      .map((row) => asString(row.source_interaction_id));
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

  getOwnedBranchRuntimeContext(ownerId: string, branchId: string): BranchRuntimeContext | null {
    const row = this.db.prepare(`SELECT b.conversation_id, b.conversation_ref_json,
        b.observed_conversation_ref_json, b.conversation_started_at,
        b.observed_conversation_started_at, c.runtime_id, c.agent_profile_id,
        (SELECT i.created_at FROM interactions i WHERE i.id = b.head_interaction_id) AS last_interaction_at
      FROM branches b JOIN canvases c ON c.id = b.canvas_id
      WHERE b.id = ? AND c.owner_id = ?`).get(branchId, ownerId) as SqlRow | undefined;
    if (!row) return null;
    const nullableNumber = (value: unknown): number | null =>
      value === null || value === undefined ? null : asNumber(value);
    const conversationRef = parseRuntimeHandle(row.conversation_ref_json);
    if (!conversationRef) return null;
    return {
      runtimeId: asString(row.runtime_id),
      agentProfileId: asString(row.agent_profile_id),
      conversationRef,
      observedConversationRef: parseRuntimeHandle(row.observed_conversation_ref_json),
      conversationStartedAt: nullableNumber(row.conversation_started_at),
      observedConversationStartedAt: nullableNumber(row.observed_conversation_started_at),
      lastInteractionAt: nullableNumber(row.last_interaction_at),
    };
  }

  observeBranchConversation(
    branchId: string,
    conversationRef: RuntimeHandle,
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
        c.runtime_id, c.agent_profile_id, c.owner_id
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
        runtimeId: asString(sourceRow.runtime_id),
        profileId: asString(sourceRow.agent_profile_id),
      },
    );
  }

  private buildCanonicalSnapshot(interactionId: string): CanonicalCanvasSnapshot {
    const rows: SqlRow[] = [];
    let cursor: string | null = interactionId;
    const chainSeen = new Set<string>();
    while (cursor && !chainSeen.has(cursor)) {
      chainSeen.add(cursor);
      const row = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(cursor) as SqlRow | undefined;
      if (!row) break;
      rows.push(row);
      cursor = asNullableString(row.parent_interaction_id);
    }
    rows.reverse();

    const seen = new Set<string>();
    const nestedResources: CanvasContextResource[] = [];
    const history = rows.flatMap((row) => {
      const id = asString(row.id);
      const nested = this.getInteractionMergeContextSnapshot(id);
      const additions = (nested?.interactions || []).flatMap((interaction) => {
        if (seen.has(interaction.id)) return [];
        seen.add(interaction.id);
        return [{
          id: interaction.id,
          user: interaction.user,
          assistant: interaction.assistant,
          attachments: [],
          artifacts: [],
          inputDocument: interaction.inputDocument,
          resourceReferences: interaction.resourceReferences,
        }];
      });
      if (nested) nestedResources.push(...nested.resources);
      if (seen.has(id)) return additions;
      seen.add(id);
      return [...additions, {
        id,
        user: asString(row.user_input),
        assistant: asString(row.agent_output),
        attachments: parseJson<CanvasAttachment[]>(row.attachments_json, []),
        artifacts: this.listInteractionArtifacts(id),
        inputDocument: parseJson<CanvasInputDocument>(
          row.input_document_json,
          textInputDocument(asString(row.user_input)),
        ),
        resourceReferences: this.listTurnResourceReferences('interaction_id', id),
      }];
    });
    const snapshot = assembleCanonicalCanvasSnapshot(history);
    return { ...snapshot, resources: [...nestedResources, ...snapshot.resources] };
  }

  private buildMergeContextSnapshot(
    ownerId: string,
    branch: BranchRecord,
    expectedHeadInteractionId: string | null,
    base: CanonicalCanvasSnapshot,
  ): MergeContextSnapshot | undefined {
    const sources = this.listMergeSourcesForGeneration(
      ownerId,
      branch.id,
      expectedHeadInteractionId,
    );
    if (sources.length === 0) return undefined;

    type Node = {
      interaction: InteractionRecord;
      predecessors: Set<string>;
    };
    const nodes = new Map<string, Node>();
    const closureMemo = new Map<string, Set<string>>();
    const visiting = new Set<string>();
    const closure = (interactionId: string): Set<string> => {
      const memo = closureMemo.get(interactionId);
      if (memo) return new Set(memo);
      if (visiting.has(interactionId)) throw new Error('invalid_upstream_graph');
      visiting.add(interactionId);
      const interaction = this.getOwnedInteraction(ownerId, interactionId);
      if (!interaction || interaction.canvasId !== branch.canvasId) {
        throw new Error('invalid_upstream_graph');
      }
      const predecessors = new Set<string>();
      const result = new Set<string>();
      if (interaction.parentInteractionId) {
        closure(interaction.parentInteractionId).forEach((id) => result.add(id));
        predecessors.add(interaction.parentInteractionId);
      }
      const nestedRows = this.db.prepare(`SELECT source_interaction_id
        FROM turn_merge_sources WHERE interaction_id = ? ORDER BY ordinal`)
        .all(interactionId) as SqlRow[];
      for (const row of nestedRows) {
        const nestedSourceId = asString(row.source_interaction_id);
        closure(nestedSourceId).forEach((id) => result.add(id));
        predecessors.add(nestedSourceId);
      }
      result.add(interactionId);
      nodes.set(interactionId, { interaction, predecessors });
      visiting.delete(interactionId);
      closureMemo.set(interactionId, result);
      return new Set(result);
    };

    const sourceClosures = sources.map((source) => closure(source.sourceInteractionId));
    const included = new Set(sourceClosures.flatMap((items) => [...items]));
    const successors = new Map<string, Set<string>>();
    const indegree = new Map<string, number>();
    for (const id of included) {
      indegree.set(id, 0);
      successors.set(id, new Set());
    }
    for (const id of included) {
      for (const predecessor of nodes.get(id)?.predecessors || []) {
        if (!included.has(predecessor)) continue;
        successors.get(predecessor)!.add(id);
        indegree.set(id, (indegree.get(id) || 0) + 1);
      }
    }
    const minSourceOrdinal = (id: string) => {
      const ordinals = sourceClosures.flatMap((items, index) => items.has(id) ? [sources[index].ordinal] : []);
      return Math.min(...ordinals);
    };
    const depths = new Map<string, number>();
    const depth = (id: string): number => {
      const existing = depths.get(id);
      if (existing !== undefined) return existing;
      const predecessors = [...(nodes.get(id)?.predecessors || [])].filter((item) => included.has(item));
      const value = predecessors.length ? Math.max(...predecessors.map(depth)) + 1 : 0;
      depths.set(id, value);
      return value;
    };
    const compare = (left: string, right: string) => {
      const leftInteraction = nodes.get(left)!.interaction;
      const rightInteraction = nodes.get(right)!.interaction;
      return minSourceOrdinal(left) - minSourceOrdinal(right)
        || depth(left) - depth(right)
        || leftInteraction.createdAt - rightInteraction.createdAt
        || left.localeCompare(right);
    };
    const ready = [...included].filter((id) => indegree.get(id) === 0).sort(compare);
    const ordered: string[] = [];
    while (ready.length) {
      const id = ready.shift()!;
      ordered.push(id);
      for (const successor of successors.get(id) || []) {
        const next = (indegree.get(successor) || 0) - 1;
        indegree.set(successor, next);
        if (next === 0) {
          ready.push(successor);
          ready.sort(compare);
        }
      }
    }
    if (ordered.length !== included.size) throw new Error('invalid_upstream_graph');

    const baseMarkerById = new Map(base.interactions.map((item, index) => [
      item.id,
      `B${String(index + 1).padStart(3, '0')}`,
    ]));
    const newIds = ordered.filter((id) => !baseMarkerById.has(id));
    const contextMarkerById = new Map(newIds.map((id, index) => [
      id,
      `C${String(index + 1).padStart(3, '0')}`,
    ]));
    const contextEntries = newIds.map((id) => {
      const interaction = nodes.get(id)!.interaction;
      return {
        id,
        user: interaction.userInput,
        assistant: interaction.agentOutput,
        attachments: interaction.attachments,
        artifacts: interaction.artifacts,
        inputDocument: interaction.inputDocument,
        resourceReferences: interaction.resourceReferences,
      };
    });
    const contextSnapshot = assembleCanonicalCanvasSnapshot(contextEntries);
    const interactions: Array<MergeContextInteraction & { marker: string }> = newIds.map((id) => {
      const interaction = nodes.get(id)!.interaction;
      return {
        id,
        branchId: interaction.branchId,
        createdAt: interaction.createdAt,
        user: interaction.userInput,
        assistant: interaction.agentOutput,
        inputDocument: interaction.inputDocument,
        resourceReferences: interaction.resourceReferences,
        marker: contextMarkerById.get(id)!,
      };
    });
    return {
      version: 1,
      sources: sources.map((source, index) => {
        const interaction = nodes.get(source.sourceInteractionId)!.interaction;
        return {
          mergeSourceId: source.id,
          sourceInteractionId: source.sourceInteractionId,
          sourceBranchId: interaction.branchId,
          sourceCreatedAt: interaction.createdAt,
          sourceUserInput: interaction.userInput.slice(0, 500),
          ordinal: source.ordinal,
          path: ordered.flatMap((id) => {
            if (!sourceClosures[index].has(id)) return [];
            const marker = baseMarkerById.get(id) || contextMarkerById.get(id);
            return marker ? [{ interactionId: id, marker, resident: baseMarkerById.has(id) }] : [];
          }),
        };
      }),
      interactions,
      resources: contextSnapshot.resources,
    };
  }

  prepareSend(ownerId: string, input: {
    branchId: string;
    expectedHeadInteractionId?: string | null;
    userInput: string;
    inputDocument?: CanvasInputDocument;
    resourceReferences?: CanvasResourceReferenceSnapshot[];
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
      const source = this.db.prepare(`SELECT i.*, b.canvas_id, c.runtime_id, c.agent_profile_id
        FROM interactions i
        JOIN branches b ON b.id = i.branch_id
        JOIN canvases c ON c.id = b.canvas_id
        WHERE i.id = ? AND c.owner_id = ?`).get(input.interactionId, ownerId) as SqlRow | undefined;
      if (!source) throw new Error('not_found');
      const agentRef = {
        runtimeId: asString(source.runtime_id),
        profileId: asString(source.agent_profile_id),
      };
      if (
        agentRef.runtimeId !== input.expectedAgentRef.runtimeId
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
        inputDocument: parseJson<CanvasInputDocument>(
          source.input_document_json,
          textInputDocument(asString(source.user_input)),
        ),
        resourceReferences: this.listTurnResourceReferences('interaction_id', input.interactionId)
          .map((reference) => reference.origin === 'current_turn_attachment'
            ? { ...reference, sourceInteractionId: null }
            : reference),
        attachments: input.attachments,
      });
    });
  }

  private prepareSendInTransaction(ownerId: string, input: {
    branchId: string;
    expectedHeadInteractionId?: string | null;
    userInput: string;
    inputDocument?: CanvasInputDocument;
    resourceReferences?: CanvasResourceReferenceSnapshot[];
    attachments: CanvasAttachment[];
    forceSessionRecovery?: boolean;
  }): SendReservation {
    const branch = this.getOwnedBranch(ownerId, input.branchId);
    if (!branch) throw new Error('not_found');
    const runtimeContext = this.getOwnedBranchRuntimeContext(ownerId, input.branchId);
    if (!runtimeContext) throw new Error('not_found');
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
    const inputDocument = normalizeCanvasInputDocument(
      input.inputDocument || textInputDocument(input.userInput),
    );
    const resourceReferences = input.resourceReferences || [];
    const expectedHead = decision.expectedHeadInteractionId;
    let replay: Parameters<typeof compileCanvasTurnMaterials>[0]['replay'];
    let baseSnapshot: CanonicalCanvasSnapshot = { version: 3, interactions: [], resources: [] };
    if (decision.replayReason === 'canonical-replay') {
      const row = this.db.prepare('SELECT snapshot_json FROM branches WHERE id = ?').get(branch.id) as SqlRow;
      const snapshot = parseJson<CanonicalCanvasSnapshot>(row.snapshot_json, {
        version: 3,
        interactions: [],
        resources: [],
      });
      baseSnapshot = snapshot;
      replay = { snapshot, reason: 'canonical-replay' };
    } else if (decision.replayReason === 'session-recovery' && branch.headInteractionId) {
      const snapshot = this.buildCanonicalSnapshot(branch.headInteractionId);
      baseSnapshot = snapshot;
      replay = { snapshot, reason: 'session-recovery' };
    } else if (materialization === 'continue-existing' && branch.headInteractionId) {
      baseSnapshot = this.buildCanonicalSnapshot(branch.headInteractionId);
    }
    const mergeContextSnapshot = this.buildMergeContextSnapshot(
      ownerId,
      branch,
      expectedHead,
      baseSnapshot,
    );
    const compiled = compileCanvasTurnMaterials({
      document: inputDocument,
      references: resourceReferences,
      attachments: input.attachments,
      ...(replay ? { replay } : {}),
      ...(mergeContextSnapshot ? { merge: mergeContextSnapshot } : {}),
    });
    const outgoingMessage = compiled.message;
    const bootstrapResources = compiled.bootstrapResources;

    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`INSERT INTO send_reservations
      (id, branch_id, expected_head_interaction_id, user_input, input_document_json, attachments_json,
        materialization, conversation_id, runtime_id, conversation_ref_json,
        outgoing_message, bootstrap_resources_json, merge_context_snapshot_json,
        status, dispatch_state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', 'reserved', ?, ?)`)
      .run(
        id,
        branch.id,
        expectedHead,
        input.userInput,
        JSON.stringify(inputDocument),
        JSON.stringify(compiled.attachments),
        materialization,
        branch.conversationId,
        runtimeContext.runtimeId,
        JSON.stringify(runtimeContext.conversationRef),
        outgoingMessage,
        JSON.stringify(bootstrapResources),
        mergeContextSnapshot ? JSON.stringify(mergeContextSnapshot) : null,
        now,
        now,
      );
    if (mergeContextSnapshot) {
      const insertMergeSource = this.db.prepare(`INSERT INTO turn_merge_sources
        (id, send_reservation_id, composer_merge_source_id, source_interaction_id, ordinal,
          source_branch_id_snapshot, source_created_at_snapshot, source_user_input_snapshot,
          created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const source of mergeContextSnapshot.sources) {
        insertMergeSource.run(
          randomUUID(), id, source.mergeSourceId, source.sourceInteractionId, source.ordinal,
          source.sourceBranchId, source.sourceCreatedAt, source.sourceUserInput, now, now,
        );
      }
    }
    const insertReference = this.db.prepare(`INSERT INTO turn_resource_references
      (id, send_reservation_id, reference_key, origin, resource_kind,
        source_interaction_id, resource_id, ordinal, name_snapshot, mime_type_snapshot,
        size_bytes_snapshot, uri_snapshot, content_hash_snapshot, available_snapshot,
        warning_snapshot, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const reference of compiled.references) {
      insertReference.run(
        randomUUID(), id, reference.key, reference.origin, reference.kind,
        reference.sourceInteractionId, reference.resourceId, reference.ordinal,
        reference.name, reference.mimeType, reference.sizeBytes ?? null, reference.uri,
        reference.contentHash || null, reference.available ? 1 : 0,
        reference.warning || null, now, now,
      );
    }
    return this.getReservation(id)!;
  }

  getReservation(id: string): SendReservation | null {
    const row = this.db.prepare('SELECT * FROM send_reservations WHERE id = ?').get(id) as SqlRow | undefined;
    if (!row) return null;
    const bootstrapResources = parseJson<CanvasContextResource[]>(row.bootstrap_resources_json, []);
    const conversationId = asString(row.conversation_id);
    const userInput = asString(row.user_input);
    return {
      id: asString(row.id),
      branchId: asString(row.branch_id),
      expectedHeadInteractionId: asNullableString(row.expected_head_interaction_id),
      userInput,
      inputDocument: parseJson<CanvasInputDocument>(row.input_document_json, textInputDocument(userInput)),
      resourceReferences: this.listTurnResourceReferences('send_reservation_id', id),
      attachments: parseJson<CanvasAttachment[]>(row.attachments_json, []),
      materialization: asString(row.materialization) as SendMaterialization,
      conversationId,
      runtimeId: asString(row.runtime_id),
      conversationRef: parseRuntimeHandle(row.conversation_ref_json) || undefined,
      dispatchRecoveryRef: parseRuntimeHandle(row.dispatch_recovery_ref_json),
      outgoingMessage: asString(row.outgoing_message),
      snapshotVersion: ['canonical-replay', 'session-recovery'].includes(asString(row.materialization)) ? 3 : undefined,
      bootstrapResources,
      mergeContextSnapshot: parseJson<MergeContextSnapshot | undefined>(
        row.merge_context_snapshot_json,
        undefined,
      ),
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
        c.runtime_id, c.agent_profile_id
      FROM send_reservations r
      JOIN branches b ON b.id = r.branch_id
      JOIN canvases c ON c.id = b.canvas_id
      WHERE r.id = ?`).get(id) as SqlRow | undefined;
    const reservation = row ? this.getReservation(id) : null;
    return reservation && row ? {
      ...reservation,
      ownerId: asString(row.owner_id),
      canvasId: asString(row.canvas_id),
      runtimeId: asString(row.runtime_id) || reservation.runtimeId,
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

  scheduleReservationRetry(
    id: string,
    state: 'reserved' | 'ambiguous',
    error: string,
    nextAttemptAt: number,
    recoveryRef?: RuntimeHandle | null,
  ): SendReservation | null {
    this.db.prepare(`UPDATE send_reservations
      SET dispatch_state = ?, error = ?, next_attempt_at = ?,
        dispatch_recovery_ref_json = COALESCE(?, dispatch_recovery_ref_json), updated_at = ?
      WHERE id = ? AND status = 'prepared'`)
      .run(
        state,
        error,
        nextAttemptAt,
        recoveryRef ? JSON.stringify(recoveryRef) : null,
        Date.now(),
        id,
      );
    return this.getReservation(id);
  }

  clearReservationDispatchRecovery(id: string): SendReservation | null {
    this.db.prepare(`UPDATE send_reservations SET dispatch_recovery_ref_json = NULL, updated_at = ?
      WHERE id = ? AND status = 'prepared'`).run(Date.now(), id);
    return this.getReservation(id);
  }

  adoptReservationConversation(
    id: string,
    conversationRef: RuntimeHandle,
    instanceId?: string,
  ): SendReservation | null {
    const reservation = this.getDispatchableReservation(id);
    if (!reservation) return null;
    if (conversationRef.runtimeId !== reservation.runtimeId) {
      throw new Error('Conversation reference belongs to a different Agent Runtime');
    }
    this.transaction(() => {
      this.db.prepare(`UPDATE send_reservations SET conversation_ref_json = ?, updated_at = ?
        WHERE id = ? AND status = 'prepared'`)
        .run(JSON.stringify(conversationRef), Date.now(), id);
      this.observeBranchConversation(
        reservation.branchId,
        conversationRef,
        instanceId,
      );
    });
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
    runtimeTurnId: string | null,
    bootstrapWarnings: string[] = [],
    turnRef: RuntimeHandle | null = null,
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
        (id, branch_id, parent_interaction_id, runtime_turn_id, turn_ref_json, user_input,
          input_document_json, status, attachments_json, execution_metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'streaming', ?, ?, ?, ?)`)
        .run(id, asString(row.branch_id), parentId, runtimeTurnId, turnRef ? JSON.stringify(turnRef) : null,
          asString(row.user_input), asNullableString(row.input_document_json), asString(row.attachments_json), JSON.stringify({
          materialization: row.materialization,
          conversationId: row.conversation_id,
          ...(bootstrapWarnings.length ? { bootstrapWarnings } : {}),
        }), now, now);
      this.db.prepare(`UPDATE turn_resource_references
        SET interaction_id = ?,
          source_interaction_id = CASE
            WHEN origin = 'current_turn_attachment' THEN ?
            ELSE source_interaction_id
          END,
          updated_at = ?
        WHERE send_reservation_id = ?`)
        .run(id, id, now, reservationId);
      this.db.prepare(`UPDATE turn_merge_sources
        SET interaction_id = ?, updated_at = ?
        WHERE send_reservation_id = ?`)
        .run(id, now, reservationId);
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
        runtime_turn_id = ?, interaction_id = ?, next_attempt_at = NULL,
        error = NULL, updated_at = ? WHERE id = ?`)
        .run(runtimeTurnId, id, now, reservationId);
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
        c.owner_id, c.agent_profile_id, c.runtime_id, c.agent_profile_id
      FROM interactions i JOIN branches b ON b.id = i.branch_id JOIN canvases c ON c.id = b.canvas_id
      WHERE i.id = ? AND c.owner_id = ?`).get(interactionId, ownerId) as SqlRow | undefined;
    return row ? this.hydrateOwnedInteraction(mapOwnedInteraction(row)) : null;
  }

  getInteractionForReconciliation(interactionId: string): OwnedInteractionRecord | null {
    const row = this.db.prepare(`SELECT i.*, b.canvas_id, b.conversation_id, b.conversation_ref_json,
        b.conversation_instance_id, b.observed_conversation_instance_id, b.conversation_integrity,
        c.owner_id, c.agent_profile_id, c.runtime_id, c.agent_profile_id
      FROM interactions i JOIN branches b ON b.id = i.branch_id JOIN canvases c ON c.id = b.canvas_id
      WHERE i.id = ?`).get(interactionId) as SqlRow | undefined;
    return row ? this.hydrateOwnedInteraction(mapOwnedInteraction(row)) : null;
  }

  listReconciliationCandidates(limit = 500, offset = 0): OwnedInteractionRecord[] {
    const rows = this.db.prepare(`SELECT i.*, b.canvas_id, b.conversation_id, b.conversation_ref_json,
        b.conversation_instance_id, b.observed_conversation_instance_id, b.conversation_integrity,
        c.owner_id, c.agent_profile_id, c.runtime_id, c.agent_profile_id
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
      const nextError = input.error ?? (input.status === 'failed' ? input.agentOutput || 'Agent Runtime turn failed' : null);
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
    const mergeSources: MergeSourceRecord[] = [];
    const removed = {
      branchIds: [] as string[],
      interactionIds: [] as string[],
      sendOperationIds: [] as string[],
      mergeSourceIds: [] as string[],
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
      } else if (type === 'merge_source') {
        const row = this.db.prepare(`SELECT s.*,
            (SELECT t.interaction_id FROM turn_merge_sources t
              WHERE t.composer_merge_source_id = s.id AND t.interaction_id IS NOT NULL
              ORDER BY t.created_at LIMIT 1) AS target_interaction_id
          FROM composer_merge_sources s
          JOIN branches b ON b.id = s.target_branch_id
          JOIN canvases c ON c.id = b.canvas_id
          WHERE s.id = ? AND b.canvas_id = ? AND c.owner_id = ?`)
          .get(id, canvasId, ownerId) as SqlRow | undefined;
        if (row) mergeSources.push(mapMergeSource(row));
        else removed.mergeSourceIds.push(id);
      }
    }
    return {
      cursor: changes.length ? asNumber(changes[changes.length - 1].seq) : this.getCanvasCursor(canvasId),
      ...(includeCanvas ? { canvas: this.getCanvas(ownerId, canvasId) || undefined } : {}),
      branches,
      interactions,
      sendOperations,
      mergeSources,
      removed,
    };
  }

  findInteractionByRuntimeCorrelation(
    runtimeId: string,
    turnRef: RuntimeHandle | null,
    conversationRef: RuntimeHandle | null,
    includeTerminal = false,
  ): OwnedInteractionRecord | null {
    const stateFilter = includeTerminal
      ? ''
      : "AND i.execution_state IN ('running', 'unconfirmed')";
    if (turnRef) {
      const row = this.db.prepare(`SELECT i.*, b.canvas_id, b.conversation_id, b.conversation_ref_json,
          b.conversation_instance_id, b.observed_conversation_instance_id, b.conversation_integrity,
          c.owner_id, c.agent_profile_id, c.runtime_id, c.agent_profile_id
        FROM interactions i
        JOIN branches b ON b.id = i.branch_id
        JOIN canvases c ON c.id = b.canvas_id
        WHERE c.runtime_id = ? AND i.turn_ref_json = ?
          ${stateFilter}
        ORDER BY i.created_at DESC LIMIT 1`).get(runtimeId, JSON.stringify(turnRef)) as SqlRow | undefined;
      return row ? this.hydrateOwnedInteraction(mapOwnedInteraction(row)) : null;
    }
    if (!conversationRef) return null;
    const rows = this.db.prepare(`SELECT i.*, b.canvas_id, b.conversation_id, b.conversation_ref_json,
        b.conversation_instance_id, b.observed_conversation_instance_id, b.conversation_integrity,
        c.owner_id, c.agent_profile_id, c.runtime_id, c.agent_profile_id
      FROM interactions i
      JOIN branches b ON b.id = i.branch_id
      JOIN canvases c ON c.id = b.canvas_id
      WHERE c.runtime_id = ? AND b.conversation_ref_json = ?
        ${stateFilter}
      ORDER BY i.created_at DESC LIMIT 2`).all(runtimeId, JSON.stringify(conversationRef)) as SqlRow[];
    return rows.length === 1 ? this.hydrateOwnedInteraction(mapOwnedInteraction(rows[0])) : null;
  }

  recordInteractionApproval(
    interactionId: string,
    runtimeId: string,
    approvalRef: RuntimeHandle,
    approval: ApprovalSummary,
    createdAt = Date.now(),
  ): InteractionApprovalRecord | null {
    const id = randomUUID();
    this.db.prepare(`INSERT OR IGNORE INTO interaction_approvals
      (id, interaction_id, runtime_id, approval_ref_json, category, title, description,
        risk, permissions_json, choices_json, expires_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).run(
      id,
      interactionId,
      runtimeId,
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
      WHERE runtime_id = ? AND approval_ref_json = ?`)
      .get(runtimeId, JSON.stringify(approvalRef)) as SqlRow | undefined;
    return row ? mapInteractionApproval(row) : null;
  }

  applyInteractionApprovalResolution(
    runtimeId: string,
    approvalRef: RuntimeHandle,
    resolution: ApprovalResolution,
    resolvedBy?: string,
  ): OwnedInteractionApprovalResolution | null {
    const row = this.db.prepare(`SELECT a.*, b.canvas_id, c.owner_id
      FROM interaction_approvals a
      JOIN interactions i ON i.id = a.interaction_id
      JOIN branches b ON b.id = i.branch_id
      JOIN canvases c ON c.id = b.canvas_id
      WHERE a.runtime_id = ? AND a.approval_ref_json = ?`)
      .get(runtimeId, JSON.stringify(approvalRef)) as SqlRow | undefined;
    if (!row) return null;
    const approval = mapInteractionApproval(row);
    const choice = approval.choices.find((candidate) => candidate.id === resolution.choiceId);
    const requestedPermissionIds = new Set(approval.permissions.map((permission) => permission.id));
    const grantedPermissionIds = resolution.grantedPermissionIds || [];
    const invalidResolution = !choice
      || grantedPermissionIds.some((permissionId) => !requestedPermissionIds.has(permissionId))
      || (choice.intent === 'deny' && grantedPermissionIds.length > 0);
    const now = Date.now();
    if (invalidResolution) {
      this.db.prepare(`UPDATE interaction_approvals SET status = 'unconfirmed', resolution_json = ?,
        resolved_by = ?, resolved_at = NULL, error = 'approval_resolution_invalid', updated_at = ?
        WHERE id = ?`).run(
        JSON.stringify(resolution),
        resolvedBy || null,
        now,
        approval.id,
      );
      return {
        approval: mapInteractionApproval(
          this.db.prepare('SELECT * FROM interaction_approvals WHERE id = ?').get(approval.id) as SqlRow,
        ),
        ownerId: asString(row.owner_id),
        canvasId: asString(row.canvas_id),
      };
    }
    const status: InteractionApprovalStatus = choice?.intent === 'deny' ? 'denied' : 'resolved';
    this.db.prepare(`UPDATE interaction_approvals SET status = ?, resolution_json = ?,
      resolved_by = ?, resolved_at = ?, error = NULL, updated_at = ? WHERE id = ?`).run(
      status,
      JSON.stringify(resolution),
      resolvedBy || null,
      now,
      now,
      approval.id,
    );
    return {
      approval: mapInteractionApproval(
        this.db.prepare('SELECT * FROM interaction_approvals WHERE id = ?').get(approval.id) as SqlRow,
      ),
      ownerId: asString(row.owner_id),
      canvasId: asString(row.canvas_id),
    };
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
    confirmed = false,
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
      if (choice.requiresConfirmation && !confirmed) throw new Error('approval_confirmation_required');
      const requested = new Set(approval.permissions.map((permission) => permission.id));
      const granted = resolution.grantedPermissionIds || (choice.intent === 'grant' ? [...requested] : []);
      if (granted.some((permissionId) => !requested.has(permissionId))) {
        throw new Error('approval_permissions_invalid');
      }
      if (choice.intent === 'deny' && granted.length > 0) throw new Error('approval_permissions_invalid');
      const normalized: ApprovalResolution = {
        choiceId: resolution.choiceId,
        ...(granted.length ? { grantedPermissionIds: granted } : {}),
      };
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

  recordRuntimeEvent(input: StoredRuntimeEvent): boolean {
    const result = this.db.prepare(`INSERT OR IGNORE INTO runtime_event_inbox
      (event_key, runtime_id, conversation_ref_json, turn_ref_json, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      input.eventKey,
      input.runtimeId,
      input.conversationRef ? JSON.stringify(input.conversationRef) : null,
      input.turnRef ? JSON.stringify(input.turnRef) : null,
      input.event.type,
      JSON.stringify(input.event),
      input.createdAt,
    );
    return Number(result.changes) > 0;
  }

  listPendingRuntimeEvents(
    runtimeId: string,
    turnRef: RuntimeHandle | null,
    conversationRef: RuntimeHandle,
  ): StoredRuntimeEvent[] {
    const turnJson = turnRef ? JSON.stringify(turnRef) : '';
    const conversationJson = JSON.stringify(conversationRef);
    const rows = this.db.prepare(`SELECT * FROM runtime_event_inbox
      WHERE runtime_id = ? AND processed_at IS NULL
        AND ((? != '' AND turn_ref_json = ?) OR conversation_ref_json = ?)
      ORDER BY created_at, event_key`).all(runtimeId, turnJson, turnJson, conversationJson) as SqlRow[];
    return rows.flatMap((row) => {
      const event = parseJson<RuntimeEvent | null>(row.payload_json, null);
      if (!event) return [];
      return [{
        eventKey: asString(row.event_key),
        runtimeId: asString(row.runtime_id),
        conversationRef: parseRuntimeHandle(row.conversation_ref_json),
        turnRef: parseRuntimeHandle(row.turn_ref_json),
        event,
        createdAt: asNumber(row.created_at),
      }];
    });
  }

  markRuntimeEventProcessed(eventKey: string): void {
    this.db.prepare(`UPDATE runtime_event_inbox SET processed_at = ?
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
        AND r.status = 'failed'
        AND r.expected_head_interaction_id IS b.head_interaction_id
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
    const mergeSources = (this.db.prepare(`SELECT s.*,
        (SELECT t.interaction_id FROM turn_merge_sources t
          WHERE t.composer_merge_source_id = s.id AND t.interaction_id IS NOT NULL
          ORDER BY t.created_at LIMIT 1) AS target_interaction_id
      FROM composer_merge_sources s
      JOIN branches b ON b.id = s.target_branch_id
      WHERE b.canvas_id = ? ORDER BY s.created_at, s.ordinal`).all(canvasId) as SqlRow[])
      .map(mapMergeSource);
    return {
      cursor: this.getCanvasCursor(canvasId),
      canvas,
      branches,
      interactions,
      layout: layoutRow ? parseJson(rowValue(layoutRow, 'layout_json'), null) : null,
      pendingSends,
      failedSends,
      mergeSources,
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

export function getCanvasStore(createConversationHandle?: ConversationHandleFactory): CanvasStore {
  store ||= new CanvasStore(config.canvasDatabasePath, { createConversationHandle });
  return store;
}

export function resetCanvasStoreForTests(): void {
  store?.close();
  store = null;
}
