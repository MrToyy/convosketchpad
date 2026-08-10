import type { DatabaseSync } from 'node:sqlite';
import { V040_TO_V050_RESOURCE_REFERENCES_MIGRATION } from './migration-plan.js';

type SqlRow = Record<string, unknown>;

function columnNames(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as SqlRow[])
    .map((row) => String(row.name || '')));
}

export function ensureResourceReferenceSchema(db: DatabaseSync, appVersion: string): boolean {
  const interactionColumns = columnNames(db, 'interactions');
  const reservationColumns = columnNames(db, 'send_reservations');
  const needsInteractionDocument = !interactionColumns.has('input_document_json');
  const needsReservationDocument = !reservationColumns.has('input_document_json');
  const needsReferenceTable = !db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'turn_resource_references'",
  ).get();

  db.exec('BEGIN IMMEDIATE');
  try {
    if (needsInteractionDocument) {
      db.exec('ALTER TABLE interactions ADD COLUMN input_document_json TEXT');
    }
    if (needsReservationDocument) {
      db.exec('ALTER TABLE send_reservations ADD COLUMN input_document_json TEXT');
    }
    if (needsReferenceTable) {
      db.exec(`CREATE TABLE turn_resource_references (
        id TEXT PRIMARY KEY,
        send_reservation_id TEXT NOT NULL REFERENCES send_reservations(id) ON DELETE CASCADE,
        interaction_id TEXT REFERENCES interactions(id) ON DELETE CASCADE,
        reference_key TEXT NOT NULL,
        origin TEXT NOT NULL CHECK(origin IN ('current_turn_attachment', 'upstream')),
        resource_kind TEXT NOT NULL CHECK(resource_kind IN ('canvas_attachment', 'interaction_artifact')),
        source_interaction_id TEXT REFERENCES interactions(id) ON DELETE CASCADE,
        resource_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        name_snapshot TEXT NOT NULL,
        mime_type_snapshot TEXT NOT NULL,
        size_bytes_snapshot INTEGER,
        uri_snapshot TEXT NOT NULL,
        content_hash_snapshot TEXT,
        available_snapshot INTEGER NOT NULL DEFAULT 1,
        warning_snapshot TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(send_reservation_id, reference_key)
      );
      CREATE INDEX turn_resource_references_interaction
        ON turn_resource_references(interaction_id, ordinal);
      CREATE INDEX turn_resource_references_source
        ON turn_resource_references(source_interaction_id, resource_kind, resource_id);
    `);
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length > 0) {
      throw new Error('Resource reference migration left foreign-key violations');
    }
    const integrity = db.prepare('PRAGMA integrity_check').get() as {
      integrity_check?: string;
    } | undefined;
    if (integrity?.integrity_check !== 'ok') {
      throw new Error('Resource reference migration failed integrity_check');
    }
    db.prepare(`INSERT OR IGNORE INTO schema_migrations(id, applied_at, app_version)
      VALUES (?, ?, ?)`).run(V040_TO_V050_RESOURCE_REFERENCES_MIGRATION, Date.now(), appVersion);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return needsInteractionDocument || needsReservationDocument || needsReferenceTable;
}
