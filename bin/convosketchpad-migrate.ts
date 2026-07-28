#!/usr/bin/env node

import { CanvasStore } from '../server/lib/canvas-db.js';
import { config } from '../server/lib/config.js';
import { V020_TO_V030_MIGRATION } from '../server/lib/canvas-migrations.js';
import {
  CANVAS_MEDIA_BACKFILL_MIGRATION,
  runCanvasMediaBackfillMigration,
} from '../server/lib/canvas-media-derivatives.js';

async function main(): Promise<void> {
  const store = new CanvasStore(config.canvasDatabasePath);
  try {
    const rescanMedia = process.argv.includes('--rescan-media');
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
    const media = await runCanvasMediaBackfillMigration(store, { scanWhenApplied: rescanMedia });
    const postBackfillForeignKeyFailures = store.db.prepare('PRAGMA foreign_key_check').all();
    if (postBackfillForeignKeyFailures.length > 0) {
      throw new Error(`Database foreign-key validation failed after media backfill (${postBackfillForeignKeyFailures.length} row(s))`);
    }
    const postBackfillIntegrity = store.db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string };
    if (postBackfillIntegrity.integrity_check !== 'ok') {
      throw new Error('Database integrity check failed after media backfill');
    }
    process.stdout.write(
      `${V020_TO_V030_MIGRATION} applied\n`
      + (media
        ? `${CANVAS_MEDIA_BACKFILL_MIGRATION} applied: `
          + `${media.hashed} hashed, ${media.generated} generated, `
          + `${media.reused} reused, ${media.skipped} skipped\n`
        : `${CANVAS_MEDIA_BACKFILL_MIGRATION} already applied\n`),
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
