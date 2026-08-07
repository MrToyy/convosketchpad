#!/usr/bin/env node

import { CanvasStore } from '../server/lib/canvas/persistence/canvas-store.js';
import { config } from '../server/lib/config.js';
import {
  CANVAS_MEDIA_BACKFILL_MIGRATION,
  CANVAS_MIGRATION_PLAN,
} from '../server/lib/canvas/persistence/migration-plan.js';
import { runCanvasMediaBackfillMigration } from '../server/lib/canvas-media-derivatives.js';
import {
  migrateLegacyRuntimeEnv,
  validateLegacyRuntimeEnv,
} from '../server/lib/agent-runtimes/env-migration.js';
import { acquireLock, releaseLock } from '../server/lib/updater/lock.js';
import { assertDatabaseMigrationOffline } from '../server/lib/migration-maintenance.js';
import {
  parseMigrateCliOptions,
  type MigrateCliOptions,
} from '../server/lib/migrate-cli-options.js';

function printHelp(): void {
  process.stdout.write(`
  Usage: convosketchpad-migrate [options]

  Options:
    --env-only         Migrate only legacy Agent Runtime environment keys
    --rescan-media     Recheck historical media and regenerate missing derivatives
    --confirm-offline  Confirm all manually managed server processes are stopped
    --help, -h         Show this help without opening the database

`);
}

async function main(options: MigrateCliOptions): Promise<void> {
  const projectRoot = config.projectRoot;
  const inheritedLock = process.env.CONVOSKETCHPAD_MAINTENANCE_LOCK_HELD === '1';
  const inheritedOffline = process.env.CONVOSKETCHPAD_DATABASE_OFFLINE === '1';
  const lockPath = inheritedLock ? null : acquireLock(projectRoot);
  try {
    validateLegacyRuntimeEnv(projectRoot);
    if (options.envOnly) {
      const migrated = migrateLegacyRuntimeEnv(projectRoot);
      process.stdout.write(migrated
        ? 'Legacy Runtime environment configuration migrated\n'
        : 'Runtime environment configuration already current\n');
      return;
    }
    if (!inheritedOffline) {
      await assertDatabaseMigrationOffline(projectRoot, options.confirmOffline);
    }
    const store = new CanvasStore(config.canvasDatabasePath);
    try {
      const rescanMedia = options.rescanMedia;
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
      const migratedRuntimeEnv = migrateLegacyRuntimeEnv(projectRoot);
      process.stdout.write(
        `${CANVAS_MIGRATION_PLAN.map((migration) => `${migration.id} verified`).join('\n')}\n`
        + (migratedRuntimeEnv ? 'Legacy Runtime environment configuration migrated\n' : '')
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
  } finally {
    if (lockPath) releaseLock(lockPath);
  }
}

try {
  const options = parseMigrateCliOptions(process.argv.slice(2));
  if (options.help) printHelp();
  else await main(options);
} catch (error) {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
