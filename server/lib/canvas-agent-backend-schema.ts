import type { DatabaseSync } from 'node:sqlite';
import { V032_TO_V040_AGENT_BACKEND_MIGRATION } from './canvas-migration-plan.js';

type SqlRow = Record<string, unknown>;

const OBSOLETE_DEVELOPMENT_MIGRATION_IDS = [
  '0.2.0_to_single_chain_v1',
  '0.3.0_to_0.4.0_agent_backend_v1',
] as const;

function columns(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as SqlRow[])
    .map((row) => String(row.name || '')));
}

function installGenericTriggers(db: DatabaseSync): void {
  db.exec(`
    DROP TRIGGER IF EXISTS interaction_visible_version_v1;
    DROP TRIGGER IF EXISTS interaction_insert_change_v1;
    DROP TRIGGER IF EXISTS interaction_update_change_v1;
    DROP TRIGGER IF EXISTS branch_insert_change_v1;
    DROP TRIGGER IF EXISTS branch_update_change_v1;
    DROP TRIGGER IF EXISTS send_insert_change_v1;
    DROP TRIGGER IF EXISTS send_update_change_v1;
    DROP TRIGGER IF EXISTS canvas_update_change_v1;
    DROP TRIGGER IF EXISTS approval_insert_visible_v1;
    DROP TRIGGER IF EXISTS approval_update_visible_v1;
    DROP TRIGGER IF EXISTS interaction_visible_version_v2;
    DROP TRIGGER IF EXISTS interaction_insert_change_v2;
    DROP TRIGGER IF EXISTS interaction_update_change_v2;
    DROP TRIGGER IF EXISTS branch_insert_change_v2;
    DROP TRIGGER IF EXISTS branch_update_change_v2;
    DROP TRIGGER IF EXISTS send_insert_change_v2;
    DROP TRIGGER IF EXISTS send_update_change_v2;
    DROP TRIGGER IF EXISTS canvas_update_change_v2;
    DROP TRIGGER IF EXISTS approval_insert_visible_v2;
    DROP TRIGGER IF EXISTS approval_update_visible_v2;

    CREATE TRIGGER interaction_visible_version_v2
    AFTER UPDATE OF agent_output, status, execution_state, artifact_sync_state, terminal_at, error
    ON interactions WHEN NEW.version = OLD.version
    BEGIN
      UPDATE interactions SET version = OLD.version + 1 WHERE id = NEW.id;
    END;
    CREATE TRIGGER interaction_insert_change_v2 AFTER INSERT ON interactions BEGIN
      INSERT INTO canvas_changes(canvas_id, entity_type, entity_id, operation, created_at)
      SELECT b.canvas_id, 'interaction', NEW.id, 'upsert', CAST(unixepoch('subsec') * 1000 AS INTEGER)
      FROM branches b WHERE b.id = NEW.branch_id;
    END;
    CREATE TRIGGER interaction_update_change_v2
    AFTER UPDATE OF version ON interactions WHEN NEW.version != OLD.version BEGIN
      INSERT INTO canvas_changes(canvas_id, entity_type, entity_id, operation, created_at)
      SELECT b.canvas_id, 'interaction', NEW.id, 'upsert', CAST(unixepoch('subsec') * 1000 AS INTEGER)
      FROM branches b WHERE b.id = NEW.branch_id;
    END;
    CREATE TRIGGER branch_insert_change_v2 AFTER INSERT ON branches BEGIN
      INSERT INTO canvas_changes(canvas_id, entity_type, entity_id, operation, created_at)
      VALUES (NEW.canvas_id, 'branch', NEW.id, 'upsert', CAST(unixepoch('subsec') * 1000 AS INTEGER));
    END;
    CREATE TRIGGER branch_update_change_v2
    AFTER UPDATE OF conversation_state, head_interaction_id, conversation_instance_id,
      observed_conversation_instance_id, conversation_integrity ON branches BEGIN
      INSERT INTO canvas_changes(canvas_id, entity_type, entity_id, operation, created_at)
      VALUES (NEW.canvas_id, 'branch', NEW.id, 'upsert', CAST(unixepoch('subsec') * 1000 AS INTEGER));
    END;
    CREATE TRIGGER send_insert_change_v2 AFTER INSERT ON send_reservations BEGIN
      INSERT INTO canvas_changes(canvas_id, entity_type, entity_id, operation, created_at)
      SELECT b.canvas_id, 'send_operation', NEW.id, 'upsert', CAST(unixepoch('subsec') * 1000 AS INTEGER)
      FROM branches b WHERE b.id = NEW.branch_id;
    END;
    CREATE TRIGGER send_update_change_v2
    AFTER UPDATE OF status, dispatch_state, error, next_attempt_at, interaction_id ON send_reservations BEGIN
      INSERT INTO canvas_changes(canvas_id, entity_type, entity_id, operation, created_at)
      SELECT b.canvas_id, 'send_operation', NEW.id, 'upsert', CAST(unixepoch('subsec') * 1000 AS INTEGER)
      FROM branches b WHERE b.id = NEW.branch_id;
    END;
    CREATE TRIGGER canvas_update_change_v2
    AFTER UPDATE OF name, backend_id, agent_profile_id, agent_locked_at ON canvases BEGIN
      INSERT INTO canvas_changes(canvas_id, entity_type, entity_id, operation, created_at)
      VALUES (NEW.id, 'canvas', NEW.id, 'upsert', CAST(unixepoch('subsec') * 1000 AS INTEGER));
    END;
    CREATE TRIGGER approval_insert_visible_v2 AFTER INSERT ON interaction_approvals BEGIN
      UPDATE interactions SET version = version + 1, updated_at = NEW.updated_at WHERE id = NEW.interaction_id;
    END;
    CREATE TRIGGER approval_update_visible_v2
    AFTER UPDATE OF status, resolution_json, resolved_by, resolved_at, error ON interaction_approvals BEGIN
      UPDATE interactions SET version = version + 1, updated_at = NEW.updated_at WHERE id = NEW.interaction_id;
    END;
  `);
}

function recordAgentBackendMigration(db: DatabaseSync, appVersion: string): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL,
    app_version TEXT NOT NULL
  )`);
  db.prepare(`INSERT OR IGNORE INTO schema_migrations(id, applied_at, app_version)
    VALUES (?, ?, ?)`).run(V032_TO_V040_AGENT_BACKEND_MIGRATION, Date.now(), appVersion);
}

function repairMigratedAgentLocks(db: DatabaseSync): void {
  db.exec(`
    UPDATE canvases AS canvas
    SET agent_locked_at = COALESCE(
      (
        SELECT MIN(reservation.created_at)
        FROM send_reservations AS reservation
        JOIN branches AS branch ON branch.id = reservation.branch_id
        WHERE branch.canvas_id = canvas.id
      ),
      (
        SELECT MIN(interaction.created_at)
        FROM interactions AS interaction
        JOIN branches AS branch ON branch.id = interaction.branch_id
        WHERE branch.canvas_id = canvas.id
      )
    )
    WHERE canvas.agent_locked_at IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM send_reservations AS reservation
          JOIN branches AS branch ON branch.id = reservation.branch_id
          WHERE branch.canvas_id = canvas.id
        )
        OR EXISTS (
          SELECT 1 FROM interactions AS interaction
          JOIN branches AS branch ON branch.id = interaction.branch_id
          WHERE branch.canvas_id = canvas.id
        )
      );
  `);
}

function cleanupObsoleteDevelopmentMigrationLedger(db: DatabaseSync): void {
  const remove = db.prepare('DELETE FROM schema_migrations WHERE id = ?');
  for (const id of OBSOLETE_DEVELOPMENT_MIGRATION_IDS) remove.run(id);
}

function finalizeAgentBackendMigration(db: DatabaseSync, appVersion: string): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    repairMigratedAgentLocks(db);
    cleanupObsoleteDevelopmentMigrationLedger(db);
    recordAgentBackendMigration(db, appVersion);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function ensureGenericAgentBackendSchema(
  db: DatabaseSync,
  appVersion: string,
): boolean {
  const canvasColumns = columns(db, 'canvases');
  if (canvasColumns.size === 0) return false;
  if (!canvasColumns.has('agent_id')) {
    installGenericTriggers(db);
    finalizeAgentBackendMigration(db, appVersion);
    return false;
  }

  db.exec(`
    DROP TRIGGER IF EXISTS interaction_visible_version_v1;
    DROP TRIGGER IF EXISTS interaction_insert_change_v1;
    DROP TRIGGER IF EXISTS interaction_update_change_v1;
    DROP TRIGGER IF EXISTS branch_insert_change_v1;
    DROP TRIGGER IF EXISTS branch_update_change_v1;
    DROP TRIGGER IF EXISTS send_insert_change_v1;
    DROP TRIGGER IF EXISTS send_update_change_v1;
    DROP TRIGGER IF EXISTS canvas_update_change_v1;
    DROP TRIGGER IF EXISTS approval_insert_visible_v1;
    DROP TRIGGER IF EXISTS approval_update_visible_v1;
  `);
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE canvases_v2 (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES canvas_users(id),
        name TEXT NOT NULL,
        backend_id TEXT NOT NULL,
        agent_profile_id TEXT NOT NULL,
        agent_locked_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO canvases_v2
        (id, owner_id, name, backend_id, agent_profile_id, agent_locked_at, created_at, updated_at)
      SELECT canvas.id, canvas.owner_id, canvas.name,
        COALESCE(NULLIF(canvas.backend_id, ''), 'openclaw'),
        COALESCE(NULLIF(canvas.agent_profile_id, ''), canvas.agent_id),
        COALESCE(
          canvas.agent_locked_at,
          (
            SELECT MIN(reservation.created_at)
            FROM send_reservations AS reservation
            JOIN branches AS branch ON branch.id = reservation.branch_id
            WHERE branch.canvas_id = canvas.id
          ),
          (
            SELECT MIN(interaction.created_at)
            FROM interactions AS interaction
            JOIN branches AS branch ON branch.id = interaction.branch_id
            WHERE branch.canvas_id = canvas.id
          )
        ),
        canvas.created_at, canvas.updated_at
      FROM canvases AS canvas;

      CREATE TABLE branches_v2 (
        id TEXT PRIMARY KEY,
        canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('root', 'fork')),
        parent_branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
        forked_from_interaction_id TEXT,
        conversation_id TEXT NOT NULL UNIQUE,
        conversation_ref_json TEXT NOT NULL,
        observed_conversation_ref_json TEXT,
        conversation_instance_id TEXT,
        conversation_started_at INTEGER,
        observed_conversation_instance_id TEXT,
        observed_conversation_started_at INTEGER,
        conversation_integrity TEXT NOT NULL DEFAULT 'unknown',
        conversation_state TEXT NOT NULL CHECK(conversation_state IN ('draft', 'active')),
        creation_mode TEXT NOT NULL DEFAULT 'composer' CHECK(creation_mode IN ('composer', 'direct-submit')),
        head_interaction_id TEXT,
        snapshot_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO branches_v2 SELECT id, canvas_id, kind, parent_branch_id,
        forked_from_interaction_id, session_key, conversation_ref_json,
        observed_conversation_ref_json, openclaw_session_id, openclaw_session_started_at,
        observed_session_id, observed_session_started_at, session_integrity, session_state,
        creation_mode, head_interaction_id, snapshot_json, created_at, updated_at FROM branches;

      CREATE TABLE interactions_v2 (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        parent_interaction_id TEXT,
        backend_turn_id TEXT,
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
        execution_metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO interactions_v2 SELECT id, version, branch_id, parent_interaction_id,
        run_id, turn_ref_json, user_input, agent_output, status, execution_state,
        artifact_sync_state, terminal_at, error, attachments_json, artifacts_json,
        CASE WHEN json_type(session_metadata_json, '$.contextSnapshot') = 'object' THEN
          json_set(
            json_remove(session_metadata_json,
              '$.contextSnapshot.sessionKey', '$.contextSnapshot.sessionId'),
            '$.contextSnapshot.conversationInstanceId',
              json_extract(session_metadata_json, '$.contextSnapshot.sessionId'),
            '$.contextSnapshot.source', 'agent-backend',
            '$.contextSnapshot.backendId',
              COALESCE(json_extract(session_metadata_json, '$.contextSnapshot.backendId'), 'openclaw')
          )
        ELSE session_metadata_json END,
        created_at, updated_at FROM interactions;

      CREATE TABLE send_reservations_v2 (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        expected_head_interaction_id TEXT,
        user_input TEXT NOT NULL,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        materialization TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        backend_id TEXT NOT NULL,
        conversation_ref_json TEXT NOT NULL,
        dispatch_recovery_ref_json TEXT,
        outgoing_message TEXT NOT NULL,
        bootstrap_resources_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK(status IN ('prepared', 'acknowledged', 'failed')),
        dispatch_state TEXT NOT NULL DEFAULT 'reserved',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at INTEGER,
        next_attempt_at INTEGER,
        backend_turn_id TEXT,
        interaction_id TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO send_reservations_v2 SELECT id, branch_id, expected_head_interaction_id,
        user_input, attachments_json, materialization, session_key, backend_id,
        conversation_ref_json, dispatch_recovery_ref_json, outgoing_message,
        bootstrap_resources_json, status, dispatch_state, attempt_count, last_attempt_at,
        next_attempt_at, run_id, interaction_id, error, created_at, updated_at FROM send_reservations;

      CREATE TABLE interaction_artifacts_v2 (
        interaction_id TEXT NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        content_hash TEXT,
        backend_artifact_id TEXT,
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
      INSERT INTO interaction_artifacts_v2 SELECT interaction_id, id, content_hash,
        gateway_artifact_id, backend_artifact_ref_json, name, mime_type, size_bytes,
        uri, source_uri, storage, available, warning, ordinal, updated_at FROM interaction_artifacts;

      INSERT OR IGNORE INTO backend_event_inbox
        (event_key, backend_id, conversation_ref_json, turn_ref_json, event_type,
          payload_json, created_at, processed_at)
      SELECT event_key, 'openclaw',
        CASE WHEN session_key IS NULL THEN NULL ELSE json_object(
          'backendId', 'openclaw', 'schemaVersion', 1,
          'opaque', json_object('sessionKey', session_key)) END,
        CASE WHEN run_id IS NULL THEN NULL ELSE json_object(
          'backendId', 'openclaw', 'schemaVersion', 1,
          'opaque', json_object('runId', run_id)) END,
        CASE json_extract(payload_json, '$.state')
          WHEN 'final' THEN 'turn.completed'
          WHEN 'aborted' THEN 'turn.interrupted'
          ELSE 'turn.failed' END,
        json_object(
          'backendId', 'openclaw', 'eventId', event_key, 'createdAt', created_at,
          'type', CASE json_extract(payload_json, '$.state')
            WHEN 'final' THEN 'turn.completed'
            WHEN 'aborted' THEN 'turn.interrupted'
            ELSE 'turn.failed' END,
          'conversationRef', CASE WHEN session_key IS NULL THEN NULL ELSE json_object(
            'backendId', 'openclaw', 'schemaVersion', 1,
            'opaque', json_object('sessionKey', session_key)) END,
          'turnRef', CASE WHEN run_id IS NULL THEN NULL ELSE json_object(
            'backendId', 'openclaw', 'schemaVersion', 1,
            'opaque', json_object('runId', run_id)) END,
          'text', json_extract(payload_json, '$.message'),
          'error', COALESCE(json_extract(payload_json, '$.errorMessage'), 'Agent turn failed')),
        created_at, processed_at
      FROM gateway_signal_inbox WHERE event = 'chat';

      DROP TABLE interaction_artifacts;
      DROP TABLE send_reservations;
      DROP TABLE interactions;
      DROP TABLE branches;
      DROP TABLE canvases;
      DROP TABLE gateway_signal_inbox;
      ALTER TABLE canvases_v2 RENAME TO canvases;
      ALTER TABLE branches_v2 RENAME TO branches;
      ALTER TABLE interactions_v2 RENAME TO interactions;
      ALTER TABLE send_reservations_v2 RENAME TO send_reservations;
      ALTER TABLE interaction_artifacts_v2 RENAME TO interaction_artifacts;

      CREATE UNIQUE INDEX one_prepared_send_per_branch
        ON send_reservations(branch_id) WHERE status = 'prepared';
      CREATE INDEX canvas_owner_updated ON canvases(owner_id, updated_at DESC);
      CREATE INDEX interaction_branch_created ON interactions(branch_id, created_at);
      CREATE UNIQUE INDEX one_draft_root_per_canvas ON branches(canvas_id)
        WHERE kind = 'root' AND conversation_state = 'draft' AND creation_mode = 'composer';
      CREATE UNIQUE INDEX one_draft_fork_per_source ON branches(forked_from_interaction_id)
        WHERE kind = 'fork' AND conversation_state = 'draft' AND creation_mode = 'composer';
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
  installGenericTriggers(db);
  const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeyViolations.length > 0) throw new Error('Agent Backend schema migration left foreign-key violations');
  const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
  if (integrity?.integrity_check !== 'ok') throw new Error('Agent Backend schema migration failed integrity_check');
  finalizeAgentBackendMigration(db, appVersion);
  return true;
}
