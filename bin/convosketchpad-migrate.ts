#!/usr/bin/env node

import { CanvasStore } from '../server/lib/canvas-db.js';
import { config } from '../server/lib/config.js';
import {
  CANVAS_MEDIA_BACKFILL_MIGRATION,
  CANVAS_MIGRATION_PLAN,
} from '../server/lib/canvas-migration-plan.js';
import { runCanvasMediaBackfillMigration } from '../server/lib/canvas-media-derivatives.js';

async function main(): Promise<void> {
  const store = new CanvasStore(config.canvasDatabasePath);
  try {
    const rescanMedia = process.argv.includes('--rescan-media');
    const findMigration = store.db.prepare(`SELECT applied_at, app_version
      FROM schema_migrations WHERE id = ?`);
    const foreignKeyFailures = store.db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyFailures.length > 0) {
      throw new Error(`Database foreign-key validation failed (${foreignKeyFailures.length} row(s))`);
    }
    const integrity = store.db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string };
    if (integrity.integrity_check !== 'ok') throw new Error('Database integrity check failed');
    const media = await runCanvasMediaBackfillMigration(store, { scanWhenApplied: rescanMedia });
    const postBackfillForeignKeyFailures = store.db.prepare('PRAGMA foreign_key_check').all();
    if (postBackfillForeignKeyFailures.length > 0) {
      throw new Error(`Database foreign-key validation failed after media backfill (${postBackfillForeignKeyFailures.length} row(s))`);
    }
    const postBackfillIntegrity = store.db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string };
    if (postBackfillIntegrity.integrity_check !== 'ok') {
      throw new Error('Database integrity check failed after media backfill');
    }
    const missingMigrations = CANVAS_MIGRATION_PLAN
      .filter((migration) => !findMigration.get(migration.id))
      .map((migration) => migration.id);
    if (missingMigrations.length > 0) {
      throw new Error(`Required migration(s) not applied: ${missingMigrations.join(', ')}`);
    }
    process.stdout.write(
      `${CANVAS_MIGRATION_PLAN.map((migration) => `${migration.id} verified`).join('\n')}\n`
      + (media
        ? `${CANVAS_MEDIA_BACKFILL_MIGRATION} details: `
          + `${media.hashed} hashed, ${media.generated} generated, `
          + `${media.reused} reused, ${media.skipped} skipped\n`
        : ''),
    );
    media?.warnings.slice(0, 20).forEach((warning) => {
      process.stderr.write(`Thumbnail skipped: ${warning}\n`);
    });
    if (media && media.warnings.length > 20) {
      process.stderr.write(`Thumbnail skipped: ${media.warnings.length - 20} additional warning(s)\n`);
    }
  } finally {
    store.close();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
