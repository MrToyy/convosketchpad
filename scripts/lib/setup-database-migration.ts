import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createSnapshot,
  discardSnapshot,
  restoreSnapshotDatabase,
} from '../../server/lib/updater/snapshot.js';
import { MIGRATION_TIMEOUT } from '../../server/lib/updater/installer.js';
import {
  detectServiceManager,
  waitForServiceState,
} from '../../server/lib/updater/service-manager.js';
import {
  maintenanceLeaseEnvironment,
  type MaintenanceLease,
} from '../../server/lib/updater/lock.js';
import { checkHealth } from '../../server/lib/updater/health.js';

export interface SetupMigrationReporter {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
}

export async function migrateDatabaseAfterSetup(
  projectRoot: string,
  reporter: SetupMigrationReporter,
  lease: MaintenanceLease,
): Promise<void> {
  const serviceManager = detectServiceManager(projectRoot);
  if (!serviceManager) {
    reporter.warn('No matching managed service detected — deferring database migration until the next server start');
    return;
  }
  const serviceState = await serviceManager.status();
  if (serviceState === 'unknown' || serviceState === 'transitioning') {
    throw new Error(`Could not determine ${serviceManager.name} service state; refusing to migrate SQLite`);
  }
  const wasActive = serviceState === 'active';
  if (serviceManager && wasActive) {
    reporter.info(`Stopping ConvoSketchpad via ${serviceManager.name} before database migration`);
    await serviceManager.stop();
    if (await waitForServiceState(serviceManager, 'inactive') !== 'inactive') {
      throw new Error(`Could not confirm ${serviceManager.name} service is inactive; refusing to migrate SQLite`);
    }
  }

  let snapshot: ReturnType<typeof createSnapshot> | null = null;
  let restartAttempted = false;
  try {
    snapshot = createSnapshot(projectRoot, {
      includeCodeMetadata: false,
      includeEnvironment: false,
      recordLastGood: false,
    });
    execFileSync(process.execPath, [
      '--import',
      'tsx',
      resolve(projectRoot, 'bin/convosketchpad-migrate.ts'),
    ], {
      cwd: projectRoot,
      stdio: 'pipe',
      timeout: MIGRATION_TIMEOUT,
      env: {
        ...process.env,
        ...maintenanceLeaseEnvironment(lease, true),
      },
    });
    reporter.success('Database schema is up to date');
    if (serviceManager && wasActive) {
      restartAttempted = true;
      await serviceManager.restart();
      if (await waitForServiceState(serviceManager, 'active') !== 'active') {
        throw new Error(`ConvoSketchpad failed to become active via ${serviceManager.name}`);
      }
      const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { version?: string };
      if (!packageJson.version) throw new Error('package.json does not contain a version');
      const health = await checkHealth(projectRoot, packageJson.version);
      if (!health.healthy || !health.versionMatch) {
        throw new Error(health.error || 'ConvoSketchpad health check failed after setup');
      }
      reporter.info(`ConvoSketchpad restarted via ${serviceManager.name}`);
    }
    discardSnapshot(projectRoot, snapshot);
  } catch (error) {
    let databaseRestored = false;
    if (snapshot) {
      let offline = true;
      if (restartAttempted && serviceManager) {
        try {
          await serviceManager.stop();
          offline = await waitForServiceState(serviceManager, 'inactive') === 'inactive';
        } catch {
          offline = false;
        }
      }
      if (offline) {
        restoreSnapshotDatabase(projectRoot, snapshot);
        discardSnapshot(projectRoot, snapshot);
        databaseRestored = true;
      } else {
        reporter.warn('Could not confirm the restarted service is offline; the database was not replaced and the setup snapshot was retained.');
      }
    }
    if (serviceManager && wasActive) {
      reporter.warn(
        `ConvoSketchpad remains stopped after migration failure to prevent an automatic retry; fix the error, then restart it via ${serviceManager.name}.`,
      );
    }
    throw new Error(
      `Database migration failed${databaseRestored ? ' and the pre-setup database was restored' : ''}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}
