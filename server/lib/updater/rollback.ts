/**
 * Rollback to the last-known-good snapshot.
 * Checks out the saved git ref, rebuilds, and restarts the service.
 */

import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import {
  loadSnapshot,
  restoreSnapshotDatabase,
  restoreSnapshotEnvironment,
} from './snapshot.js';
import { gitCheckoutLocal, buildProject } from './installer.js';
import type { Snapshot, ServiceManager, Reporter } from './types.js';
import { waitForServiceState } from './service-manager.js';
import { loadReleaseCompatibility } from './compatibility.js';

export interface RollbackResult {
  success: boolean;
  snapshot: Snapshot | null;
  error?: string;
}

export interface RollbackOptions {
  /**
   * SQLite restoration is opt-in from a caller that has independently
   * confirmed the database is offline. Unmanaged and --no-restart flows pass
   * false so rollback cannot replace a live database.
   */
  restoreDatabase?: boolean;
  /** Use the exact snapshot created by the interrupted transaction. */
  snapshot?: Snapshot;
  /** Schema epoch known to be present when the updater did not touch SQLite. */
  currentDatabaseSchemaEpoch?: number;
}

/**
 * Restore code and environment, optionally restore SQLite, then restart a
 * supplied managed service. Database restoration is controlled separately
 * from whether the service should be restarted.
 * Does NOT throw — returns a result object.
 */
export async function rollback(
  cwd: string,
  serviceManager: ServiceManager | null,
  reporter: Reporter,
  options: RollbackOptions = {},
): Promise<RollbackResult> {
  const snapshot = options.snapshot ?? loadSnapshot(cwd);
  if (!snapshot) {
    return { success: false, snapshot: null, error: 'No snapshot found — cannot rollback' };
  }

  reporter.info(`Rolling back to ${snapshot.version} (${snapshot.ref.slice(0, 8)})`);

  try {
    if (
      options.restoreDatabase === true
      && (snapshot.kind !== 'full' || snapshot.databaseExisted === undefined)
    ) {
      throw new Error('The selected rollback point does not contain a complete database snapshot');
    }
    if (options.restoreDatabase !== true) {
      const currentEpoch = options.currentDatabaseSchemaEpoch
        ?? loadReleaseCompatibility(cwd).databaseSchemaEpoch;
      const minimum = snapshot.minimumReadableDatabaseSchemaEpoch;
      const maximum = snapshot.maximumReadableDatabaseSchemaEpoch;
      if (
        minimum === undefined
        || maximum === undefined
        || currentEpoch < minimum
        || currentEpoch > maximum
      ) {
        throw new Error(
          'Code-only rollback is unsafe because the saved release cannot prove compatibility with the current database schema epoch',
        );
      }
    }
    // 1. Stop the service before replacing code or restoring SQLite files.
    if (serviceManager) {
      reporter.verbose(`Stopping ${serviceManager.name} before rollback`);
      await serviceManager.stop();
      if (await waitForServiceState(serviceManager, 'inactive') !== 'inactive') {
        throw new Error(`Could not confirm ${serviceManager.name} service is inactive; SQLite was not restored`);
      }
    }

    // 2. Checkout the previous ref (local only — no network needed)
    reporter.verbose(`git checkout ${snapshot.ref}`);
    gitCheckoutLocal(cwd, snapshot.ref);
    reporter.ok(`Checked out ${snapshot.ref.slice(0, 8)}`);

    // 3. Restore the consistent pre-update database snapshot.
    if (options.restoreDatabase === true) {
      restoreSnapshotDatabase(cwd, snapshot);
      reporter.ok('Database snapshot restored');
    }

    restoreSnapshotEnvironment(cwd, snapshot);
    reporter.ok('Environment snapshot restored');

    // 4. Clean node_modules to avoid stale dependencies from the failed version
    const nodeModulesPath = join(cwd, 'node_modules');
    if (existsSync(nodeModulesPath)) {
      reporter.verbose('Cleaning node_modules...');
      try {
        rmSync(nodeModulesPath, { recursive: true, force: true });
      } catch {
        // Fall back to npm ci behavior — npm install will reconcile
        reporter.verbose('Could not remove node_modules, proceeding anyway');
      }
    }

    // 5. Rebuild
    reporter.verbose('Rebuilding...');
    buildProject(cwd);
    reporter.ok('Rebuild complete');

    // 6. Restart service (if available) and verify it's alive
    if (serviceManager) {
      reporter.verbose(`Restarting via ${serviceManager.name}`);
      await serviceManager.restart();
      const state = await waitForServiceState(serviceManager, 'active');
      if (state !== 'active') {
        const logs = await serviceManager.getLogs(20);
        return { success: false, snapshot, error: `Service failed to start after rollback:\n${logs}` };
      }
      reporter.ok(`Service restarted via ${serviceManager.name}`);
    }

    return { success: true, snapshot };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, snapshot, error: message };
  }
}
