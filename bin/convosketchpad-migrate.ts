#!/usr/bin/env node

import { CanvasStore } from '../server/lib/canvas-db.js';
import { config } from '../server/lib/config.js';
import { V020_TO_V030_MIGRATION } from '../server/lib/canvas-migrations.js';

function main(): void {
  const store = new CanvasStore(config.canvasDatabasePath);
  try {
    const migration = store.db.prepare(`SELECT applied_at, app_version
      FROM schema_migrations WHERE id = ?`).get(V020_TO_V030_MIGRATION) as {
        applied_at?: number;
        app_version?: string;
      } | undefined;
    if (!migration) throw new Error(`Required migration ${V020_TO_V030_MIGRATION} was not applied`);
    const foreignKeyFailures = store.db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyFailures.length > 0) {
      throw new Error(`Database foreign-key validation failed (${foreignKeyFailures.length} row(s))`);
    }
    const integrity = store.db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string };
    if (integrity.integrity_check !== 'ok') throw new Error('Database integrity check failed');
    process.stdout.write(`${V020_TO_V030_MIGRATION} applied\n`);
  } finally {
    store.close();
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
