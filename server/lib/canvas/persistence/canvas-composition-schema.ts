import type { DatabaseSync } from 'node:sqlite';
import { V050_TO_V060_CANVAS_COMPOSITION_MIGRATION } from './migration-plan.js';

export function ensureCanvasCompositionSchema(db: DatabaseSync, appVersion: string): boolean {
  const hasComposerSources = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'composer_merge_sources'",
  ).get());
  const hasTurnSources = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'turn_merge_sources'",
  ).get());
  const reservationColumns = new Set((db.prepare('PRAGMA table_info(send_reservations)').all() as Array<{ name: string }>)
    .map(({ name }) => name));
  const needsSnapshotColumn = !reservationColumns.has('merge_context_snapshot_json');
  const branchColumns = new Set((db.prepare('PRAGMA table_info(branches)').all() as Array<{ name: string }>)
    .map(({ name }) => name));
  const interactionColumns = new Set((db.prepare('PRAGMA table_info(interactions)').all() as Array<{ name: string }>)
    .map(({ name }) => name));
  const needsNodeAgents = !branchColumns.has('copied_from_interaction_id')
    || !branchColumns.has('runtime_id')
    || !branchColumns.has('agent_profile_id')
    || !interactionColumns.has('runtime_id')
    || !interactionColumns.has('agent_profile_id')
    || !interactionColumns.has('conversation_id')
    || !interactionColumns.has('conversation_ref_json')
    || !interactionColumns.has('conversation_instance_id')
    || !interactionColumns.has('observed_conversation_instance_id')
    || !reservationColumns.has('agent_profile_id')
    || !reservationColumns.has('conversation_instance_id');

  db.exec('BEGIN IMMEDIATE');
  try {
    if (!hasComposerSources) {
      db.exec(`CREATE TABLE composer_merge_sources (
        id TEXT PRIMARY KEY,
        target_branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        expected_head_interaction_id TEXT REFERENCES interactions(id) ON DELETE CASCADE,
        source_interaction_id TEXT NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX composer_merge_sources_draft_source
        ON composer_merge_sources(target_branch_id, source_interaction_id)
        WHERE expected_head_interaction_id IS NULL;
      CREATE UNIQUE INDEX composer_merge_sources_continue_source
        ON composer_merge_sources(target_branch_id, expected_head_interaction_id, source_interaction_id)
        WHERE expected_head_interaction_id IS NOT NULL;
      CREATE UNIQUE INDEX composer_merge_sources_draft_ordinal
        ON composer_merge_sources(target_branch_id, ordinal)
        WHERE expected_head_interaction_id IS NULL;
      CREATE UNIQUE INDEX composer_merge_sources_continue_ordinal
        ON composer_merge_sources(target_branch_id, expected_head_interaction_id, ordinal)
        WHERE expected_head_interaction_id IS NOT NULL;
      CREATE INDEX composer_merge_sources_source
        ON composer_merge_sources(source_interaction_id, created_at);
      `);
    }
    if (!hasTurnSources) {
      db.exec(`CREATE TABLE turn_merge_sources (
        id TEXT PRIMARY KEY,
        send_reservation_id TEXT NOT NULL REFERENCES send_reservations(id) ON DELETE CASCADE,
        composer_merge_source_id TEXT NOT NULL REFERENCES composer_merge_sources(id) ON DELETE CASCADE,
        interaction_id TEXT REFERENCES interactions(id) ON DELETE CASCADE,
        source_interaction_id TEXT NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
        source_branch_id_snapshot TEXT NOT NULL,
        source_created_at_snapshot INTEGER NOT NULL,
        source_user_input_snapshot TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(send_reservation_id, composer_merge_source_id),
        UNIQUE(send_reservation_id, ordinal)
      );
      CREATE INDEX turn_merge_sources_interaction
        ON turn_merge_sources(interaction_id, ordinal);
      CREATE INDEX turn_merge_sources_source
        ON turn_merge_sources(source_interaction_id, created_at);
      `);
    }
    if (needsSnapshotColumn) {
      db.exec('ALTER TABLE send_reservations ADD COLUMN merge_context_snapshot_json TEXT');
    }
    if (!branchColumns.has('copied_from_interaction_id')) {
      db.exec('ALTER TABLE branches ADD COLUMN copied_from_interaction_id TEXT REFERENCES interactions(id) ON DELETE SET NULL');
    }
    if (!branchColumns.has('runtime_id')) db.exec('ALTER TABLE branches ADD COLUMN runtime_id TEXT');
    if (!branchColumns.has('agent_profile_id')) db.exec('ALTER TABLE branches ADD COLUMN agent_profile_id TEXT');
    if (!interactionColumns.has('runtime_id')) db.exec('ALTER TABLE interactions ADD COLUMN runtime_id TEXT');
    if (!interactionColumns.has('agent_profile_id')) db.exec('ALTER TABLE interactions ADD COLUMN agent_profile_id TEXT');
    if (!interactionColumns.has('conversation_id')) db.exec('ALTER TABLE interactions ADD COLUMN conversation_id TEXT');
    if (!interactionColumns.has('conversation_ref_json')) db.exec('ALTER TABLE interactions ADD COLUMN conversation_ref_json TEXT');
    if (!interactionColumns.has('conversation_instance_id')) db.exec('ALTER TABLE interactions ADD COLUMN conversation_instance_id TEXT');
    if (!interactionColumns.has('observed_conversation_instance_id')) db.exec('ALTER TABLE interactions ADD COLUMN observed_conversation_instance_id TEXT');
    if (!reservationColumns.has('agent_profile_id')) db.exec('ALTER TABLE send_reservations ADD COLUMN agent_profile_id TEXT');
    if (!reservationColumns.has('conversation_instance_id')) db.exec('ALTER TABLE send_reservations ADD COLUMN conversation_instance_id TEXT');
    db.exec(`
      UPDATE branches SET
        runtime_id = CASE WHEN conversation_state = 'active' THEN
          (SELECT runtime_id FROM canvases WHERE canvases.id = branches.canvas_id) ELSE runtime_id END,
        agent_profile_id = CASE WHEN conversation_state = 'active' THEN
          (SELECT agent_profile_id FROM canvases WHERE canvases.id = branches.canvas_id) ELSE agent_profile_id END
      WHERE runtime_id IS NULL OR agent_profile_id IS NULL;
      UPDATE interactions SET
        runtime_id = COALESCE(runtime_id, (SELECT c.runtime_id FROM branches b JOIN canvases c ON c.id = b.canvas_id WHERE b.id = interactions.branch_id)),
        agent_profile_id = COALESCE(agent_profile_id, (SELECT c.agent_profile_id FROM branches b JOIN canvases c ON c.id = b.canvas_id WHERE b.id = interactions.branch_id)),
        conversation_id = COALESCE(conversation_id, (SELECT b.conversation_id FROM branches b WHERE b.id = interactions.branch_id)),
        conversation_ref_json = COALESCE(conversation_ref_json, (SELECT b.conversation_ref_json FROM branches b WHERE b.id = interactions.branch_id)),
        conversation_instance_id = COALESCE(conversation_instance_id, (SELECT b.conversation_instance_id FROM branches b WHERE b.id = interactions.branch_id)),
        observed_conversation_instance_id = COALESCE(observed_conversation_instance_id, (SELECT b.observed_conversation_instance_id FROM branches b WHERE b.id = interactions.branch_id));
      UPDATE send_reservations SET agent_profile_id = COALESCE(agent_profile_id,
        (SELECT c.agent_profile_id FROM branches b JOIN canvases c ON c.id = b.canvas_id WHERE b.id = send_reservations.branch_id));
      UPDATE send_reservations SET conversation_instance_id = COALESCE(conversation_instance_id,
        (SELECT b.conversation_instance_id FROM branches b WHERE b.id = send_reservations.branch_id));
      DELETE FROM schema_migrations WHERE id = '0.5.0_to_0.6.0_branch_merging_v1';
    `);
    db.exec(`
      DROP TRIGGER IF EXISTS composer_merge_source_insert_change_v1;
      DROP TRIGGER IF EXISTS turn_merge_source_update_change_v1;
      CREATE TRIGGER composer_merge_source_insert_change_v1
      AFTER INSERT ON composer_merge_sources BEGIN
        INSERT INTO canvas_changes(canvas_id, entity_type, entity_id, operation, created_at)
        SELECT b.canvas_id, 'merge_source', NEW.id, 'upsert', CAST(unixepoch('subsec') * 1000 AS INTEGER)
        FROM branches b WHERE b.id = NEW.target_branch_id;
      END;
      CREATE TRIGGER turn_merge_source_update_change_v1
      AFTER UPDATE OF interaction_id ON turn_merge_sources
      WHEN NEW.interaction_id IS NOT OLD.interaction_id BEGIN
        INSERT INTO canvas_changes(canvas_id, entity_type, entity_id, operation, created_at)
        SELECT b.canvas_id, 'merge_source', NEW.composer_merge_source_id, 'upsert',
          CAST(unixepoch('subsec') * 1000 AS INTEGER)
        FROM composer_merge_sources s JOIN branches b ON b.id = s.target_branch_id
        WHERE s.id = NEW.composer_merge_source_id;
      END;
    `);
    if (db.prepare('PRAGMA foreign_key_check').all().length > 0) {
      throw new Error('Canvas Composition migration left foreign-key violations');
    }
    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
    if (integrity?.integrity_check !== 'ok') {
      throw new Error('Canvas Composition migration failed integrity_check');
    }
    db.prepare(`INSERT OR IGNORE INTO schema_migrations(id, applied_at, app_version)
      VALUES (?, ?, ?)`).run(V050_TO_V060_CANVAS_COMPOSITION_MIGRATION, Date.now(), appVersion);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return !hasComposerSources || !hasTurnSources || needsSnapshotColumn || needsNodeAgents;
}
