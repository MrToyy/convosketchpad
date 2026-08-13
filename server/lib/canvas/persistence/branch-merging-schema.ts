import type { DatabaseSync } from 'node:sqlite';
import { V050_TO_V060_BRANCH_MERGING_MIGRATION } from './migration-plan.js';

export function ensureBranchMergingSchema(db: DatabaseSync, appVersion: string): boolean {
  const hasComposerSources = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'composer_merge_sources'",
  ).get());
  const hasTurnSources = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'turn_merge_sources'",
  ).get());
  const reservationColumns = new Set((db.prepare('PRAGMA table_info(send_reservations)').all() as Array<{ name: string }>)
    .map(({ name }) => name));
  const needsSnapshotColumn = !reservationColumns.has('merge_context_snapshot_json');

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
      throw new Error('Branch merging migration left foreign-key violations');
    }
    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
    if (integrity?.integrity_check !== 'ok') {
      throw new Error('Branch merging migration failed integrity_check');
    }
    db.prepare(`INSERT OR IGNORE INTO schema_migrations(id, applied_at, app_version)
      VALUES (?, ?, ?)`).run(V050_TO_V060_BRANCH_MERGING_MIGRATION, Date.now(), appVersion);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return !hasComposerSources || !hasTurnSources || needsSnapshotColumn;
}
