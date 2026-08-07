/**
 * Update orchestrator — the state machine that wires all modules together.
 *
 * Flow: lock → preflight → resolve → confirm → snapshot → update → build
 *       → restart → health → commit/rollback → unlock
 */

import { acquireLock, releaseLock, type MaintenanceLease } from './lock.js';
import { runPreflight } from './preflight.js';
import { resolveVersion } from './release-resolver.js';
import { createSnapshot } from './snapshot.js';
import {
  gitFetchAndCheckout,
  buildProject,
  migrateDatabase,
  migrateEnvironment,
} from './installer.js';
import { detectServiceManager, waitForServiceState } from './service-manager.js';
import { checkHealth, resolveHealthCheckBaseUrl } from './health.js';
import { rollback } from './rollback.js';
import { EXIT_CODES, UpdateError } from './types.js';
import type {
  UpdateOptions,
  Reporter,
  ExitCode,
  ServiceManager,
  Snapshot,
  UpdateTransaction,
} from './types.js';
import { resolveUpdaterStatePaths } from './state-paths.js';
import { writePrivateJsonAtomic } from './state-file.js';
import {
  advanceUpdateTransaction,
  attachTransactionSnapshot,
  beginUpdateTransaction,
  failUpdateTransaction,
  finishUpdateTransaction,
  loadActiveTransaction,
  loadLastTransaction,
} from './transaction.js';

/**
 * Run the full update flow. Returns an exit code.
 * All terminal output goes through the reporter.
 */
export async function orchestrate(options: UpdateOptions, reporter: Reporter): Promise<ExitCode> {
  if (options.status) return handleUpdateStatus(options, reporter);
  if (options.resume) return handleResume(options, reporter);
  if (options.rollback) {
    return handleManualRollback(options, reporter);
  }

  // Calculate total stages dynamically based on which stages will actually run
  // lock + preflight + resolve + snapshot + update + build + environment migration = 7 stages
  // + confirm (only if not --yes) + migrate + restart + health (unless --no-restart)
  const totalStages = 7 + (options.yes ? 0 : 1) + (options.noRestart ? 0 : 3);
  let stageNum = 0;
  let lease: MaintenanceLease | null = null;
  let serviceManager: ServiceManager | null = null;
  let serviceWasActive = false;
  let databaseConfirmedOffline = false;
  let snapshot: Snapshot | null = null;
  let transaction: UpdateTransaction | null = null;

  try {
    // ── 1. Lock ────────────────────────────────────────────────────
    stageNum++;
    reporter.stage('Acquiring lock', stageNum, totalStages);
    lease = acquireLock(options.cwd);
    reporter.ok('Lock acquired');

    const existingTransaction = loadActiveTransaction(options.cwd);
    if (existingTransaction?.status === 'committed' || existingTransaction?.status === 'recovered') {
      finishUpdateTransaction(options.cwd, existingTransaction, existingTransaction.status);
    } else if (existingTransaction) {
      throw new UpdateError(
        'An unfinished update transaction exists; run npm run update -- --resume',
        'lock',
        EXIT_CODES.LOCK,
      );
    }

    // ── 2. Preflight ───────────────────────────────────────────────
    stageNum++;
    reporter.stage('Preflight checks', stageNum, totalStages);
    const preflight = runPreflight(options.cwd);
    reporter.ok(`git ${preflight.gitVersion}`);
    reporter.ok(`Node.js v${preflight.nodeVersion}`);
    reporter.ok(`npm ${preflight.npmVersion}`);

    // ── 3. Resolve version ─────────────────────────────────────────
    stageNum++;
    reporter.stage('Resolving version', stageNum, totalStages);
    const resolved = await resolveVersion(options.cwd, options.version);

    if (resolved.isUpToDate) {
      reporter.ok(`Already up to date (v${resolved.current})`);
      return EXIT_CODES.UP_TO_DATE;
    }

    const sourceLabel = resolved.source === 'release' ? 'latest release' : 'pinned release';
    reporter.info(`v${resolved.current} → v${resolved.version} (${sourceLabel})`);

    // ── Dry-run stops here ─────────────────────────────────────────
    if (options.dryRun) {
      if (!options.noRestart) {
        reporter.dry('Would stop the managed service only if it is currently active');
      }
      reporter.dry(options.noRestart
        ? 'Would snapshot current code and environment without opening SQLite'
        : 'Would snapshot code and environment, plus SQLite only after confirming the managed service is offline');
      reporter.dry(`Would checkout ${resolved.tag}`);
      reporter.dry('Would run npm ci && npm run build');
      reporter.dry('Would migrate Agent Runtime environment configuration');
      if (!options.noRestart) {
        reporter.dry('Would migrate the database when the managed service is stopped');
        reporter.dry(options.leaveStopped
          ? 'Would preserve the managed service stopped after migration'
          : 'Would restore the service to its previous running/stopped state');
        reporter.dry(options.leaveStopped
          ? 'Would skip health checks because the service remains stopped'
          : 'Would run health checks only for a previously active service');
      }
      return EXIT_CODES.SUCCESS;
    }

    // ── 4. Confirm ─────────────────────────────────────────────────
    if (!options.yes) {
      stageNum++;
      reporter.stage('Confirm', stageNum, totalStages);
      const confirmed = await reporter.confirm(
        `Update v${resolved.current} → v${resolved.version}?`,
      );
      if (!confirmed) {
        reporter.info('Update cancelled');
        return EXIT_CODES.SUCCESS;
      }
      reporter.ok('Confirmed');
    }

    transaction = beginUpdateTransaction(
      options.cwd,
      resolved,
      options.noRestart,
      options.leaveStopped,
    );

    // ── 5. Snapshot ────────────────────────────────────────────────
    stageNum++;
    reporter.stage('Creating snapshot', stageNum, totalStages);
    serviceManager = options.noRestart ? null : detectServiceManager(options.cwd);
    if (options.leaveStopped && !serviceManager) {
      throw new UpdateError(
        '--leave-stopped requires a matching managed service whose offline state can be verified',
        'snapshot',
        EXIT_CODES.BUILD,
      );
    }
    if (!options.noRestart && serviceManager) {
      const serviceState = await serviceManager.status();
      if (serviceState === 'unknown' || serviceState === 'transitioning') {
        throw new UpdateError(
          `Could not determine ${serviceManager.name} service state; refusing to snapshot or migrate SQLite`,
          'snapshot',
          EXIT_CODES.BUILD,
        );
      }
      serviceWasActive = serviceState === 'active';
      databaseConfirmedOffline = serviceState === 'inactive';
    }
    transaction = advanceUpdateTransaction(options.cwd, transaction, 'service-inspected', {
      serviceManagerName: serviceManager?.name,
      serviceWasActive,
      databaseConfirmedOffline,
    });
    if (!options.noRestart && serviceManager && serviceWasActive) {
      reporter.verbose(`Stopping service via ${serviceManager.name} before database snapshot`);
      try {
        await serviceManager.stop();
        if (await waitForServiceState(serviceManager, 'inactive') !== 'inactive') {
          throw new Error('service did not reach the inactive state');
        }
        databaseConfirmedOffline = true;
        transaction = advanceUpdateTransaction(options.cwd, transaction, 'service-quiesced', {
          databaseConfirmedOffline: true,
        });
      } catch (error) {
        throw new UpdateError(
          `Could not stop service before database snapshot: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'snapshot',
          EXIT_CODES.BUILD,
        );
      }
    }
    try {
      snapshot = createSnapshot(options.cwd, {
        includeDatabase: databaseConfirmedOffline,
        recordLastGood: databaseConfirmedOffline,
      });
    } catch (error) {
      if (!options.noRestart && serviceManager && serviceWasActive) {
        try {
          await serviceManager.restart();
          await waitForServiceState(serviceManager, 'active');
        } catch (restartError) {
          reporter.fail(`Could not restart service after snapshot failure: ${
            restartError instanceof Error ? restartError.message : String(restartError)
          }`);
        }
      }
      throw new UpdateError(
        `Could not create update snapshot: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'snapshot',
        EXIT_CODES.BUILD,
      );
    }
    transaction = attachTransactionSnapshot(options.cwd, transaction, snapshot);
    reporter.ok(`Snapshot saved (ref: ${snapshot.ref.slice(0, 8)})`);

    // ── 6. Update (git checkout) ───────────────────────────────────
    stageNum++;
    reporter.stage('Updating', stageNum, totalStages);
    reporter.verbose(`Fetch and validate official release ${resolved.tag}`);
    gitFetchAndCheckout(options.cwd, resolved.tag);
    transaction = advanceUpdateTransaction(options.cwd, transaction, 'release-checked-out');
    reporter.ok(`Checked out ${resolved.tag}`);

    // ── 7. Build ───────────────────────────────────────────────────
    stageNum++;
    reporter.stage('Building', stageNum, totalStages);
    reporter.verbose('npm ci && npm run build');
    buildProject(options.cwd);
    transaction = advanceUpdateTransaction(options.cwd, transaction, 'built');
    reporter.ok('Build complete');

    stageNum++;
    reporter.stage('Migrating configuration', stageNum, totalStages);
    migrateEnvironment(options.cwd, lease);
    transaction = advanceUpdateTransaction(options.cwd, transaction, 'environment-migrated');
    reporter.ok('Agent Runtime configuration migration complete');

    // ── 9–11. Database migrate + restart + health (unless --no-restart) ─────
    if (!options.noRestart) {
      stageNum++;
      reporter.stage('Migrating database', stageNum, totalStages);
      if (databaseConfirmedOffline) {
        migrateDatabase(options.cwd, lease);
        transaction = advanceUpdateTransaction(options.cwd, transaction, 'database-migrated');
        reporter.ok('Database migration complete');
      } else {
        reporter.warn('No managed service detected — deferring database migration');
        reporter.hint('The target server will migrate the database on its next manual start.');
      }

      stageNum++;
      reporter.stage('Restarting service', stageNum, totalStages);

      if (serviceManager && serviceWasActive && !options.leaveStopped) {
        reporter.verbose(`Detected ${serviceManager.name}`);
        try {
          await serviceManager.restart();
          const state = await waitForServiceState(serviceManager, 'active');
          if (state !== 'active') {
            throw new Error(`Service failed to start via ${serviceManager.name}`);
          }
        } catch (error) {
          throw new UpdateError(
            `Could not restart service via ${serviceManager.name}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            'restart',
            EXIT_CODES.RESTART,
          );
        }
        reporter.ok(`Service restarted via ${serviceManager.name}`);
      } else if (serviceManager && serviceWasActive && options.leaveStopped) {
        reporter.ok(`Service remains stopped via ${serviceManager.name} (--leave-stopped)`);
      } else if (serviceManager) {
        reporter.ok(`Service remains stopped via ${serviceManager.name} (matching its pre-update state)`);
      } else {
        reporter.warn('No service manager detected — skipping restart');
        reporter.hint('Start the server manually:');
        reporter.cmd('npm start');
      }
      transaction = advanceUpdateTransaction(options.cwd, transaction, 'service-finalized');

      stageNum++;
      reporter.stage('Health check', stageNum, totalStages);
      if (serviceManager && serviceWasActive && !options.leaveStopped) {
        const healthBaseUrl = resolveHealthCheckBaseUrl(options.cwd);
        reporter.verbose(`Polling ${healthBaseUrl}/health and ${healthBaseUrl}/api/version...`);
        const health = await checkHealth(options.cwd, resolved.version);

        if (!health.healthy || !health.versionMatch) {
          throw new UpdateError(
            health.error ?? 'Health check failed',
            'health',
            EXIT_CODES.HEALTH,
          );
        }

        reporter.ok(`Healthy — v${health.reportedVersion}`);
        transaction = advanceUpdateTransaction(options.cwd, transaction, 'health-verified');
      } else if (serviceManager && options.leaveStopped) {
        reporter.warn('Skipped — service intentionally remains stopped');
      } else if (serviceManager) {
        reporter.warn('Skipped — service was not running before the update');
      } else {
        reporter.warn('Skipped — no managed service is available to verify');
      }
    }

    // ── Success ────────────────────────────────────────────────────
    finishUpdateTransaction(options.cwd, transaction, 'committed');
    writeLastRun(options.cwd, { success: true, from: resolved.current, to: resolved.version, exitCode: EXIT_CODES.SUCCESS });
    reporter.done(resolved.current, resolved.version);
    return EXIT_CODES.SUCCESS;
  } catch (err) {
    return await handleFailure(
      err,
      options,
      serviceManager,
      serviceWasActive,
      databaseConfirmedOffline,
      snapshot,
      transaction,
      reporter,
    );
  } finally {
    if (lease) releaseLock(lease);
  }
}

// ── Failure handler ──────────────────────────────────────────────────

async function handleFailure(
  err: unknown,
  options: UpdateOptions,
  serviceManager: ServiceManager | null,
  serviceWasActive: boolean,
  databaseConfirmedOffline: boolean,
  snapshot: Snapshot | null,
  transaction: UpdateTransaction | null,
  reporter: Reporter,
): Promise<ExitCode> {
  const isUpdateError = err instanceof UpdateError;
  const stage = isUpdateError ? err.stage : 'unknown';
  const message = err instanceof Error ? err.message : String(err);
  let exitCode: ExitCode = isUpdateError ? err.exitCode : EXIT_CODES.BUILD;

  reporter.fail(`Failed at stage: ${stage}`);
  reporter.fail(message);
  if (transaction) transaction = failUpdateTransaction(options.cwd, transaction, message);

  // Attempt rollback if we had a snapshot and the failure was after snapshot
  const rollbackStages = new Set(['update', 'build', 'migrate', 'restart', 'health']);
  if (snapshot && rollbackStages.has(stage)) {
    reporter.info('Attempting rollback...');
    const result = await rollback(
      options.cwd,
      serviceWasActive ? serviceManager : null,
      reporter,
      {
        restoreDatabase: databaseConfirmedOffline && !options.noRestart,
        snapshot,
        ...(!databaseConfirmedOffline || options.noRestart
          ? { currentDatabaseSchemaEpoch: snapshot.databaseSchemaEpoch }
          : {}),
      },
    );

    if (result.success) {
      reporter.warn(`Rolled back to v${result.snapshot?.version}`);
      if (transaction) finishUpdateTransaction(options.cwd, transaction, 'recovered');
    } else {
      reporter.fail(`Rollback failed: ${result.error}`);
      exitCode = EXIT_CODES.ROLLBACK;
    }
  }

  writeLastRun(options.cwd, { success: false, stage, error: message, exitCode });

  // Helpful hints based on failure stage
  if (stage === 'build') {
    reporter.hint('Troubleshooting:');
    reporter.cmd('npm ci');
    reporter.cmd('npm run build');
  } else if (stage === 'migrate') {
    reporter.hint('The pre-update database snapshot was retained for rollback.');
  } else if (stage === 'restart' || stage === 'health') {
    if (serviceManager) {
      reporter.hint('Check service logs:');
      reporter.cmd(
        serviceManager.name === 'systemd'
          ? 'journalctl -u convosketchpad.service -n 50 --no-pager'
          : 'log show --predicate \'processImagePath contains "convosketchpad"\' --last 5m',
      );
    }
  }

  return exitCode;
}

// ── Interrupted transaction recovery ────────────────────────────────

async function handleResume(
  options: UpdateOptions,
  reporter: Reporter,
): Promise<ExitCode> {
  let lease: MaintenanceLease | null = null;
  let retryTarget: string;
  let retryLeaveStopped: boolean;
  try {
    reporter.stage('Acquiring lock', 1, 3);
    lease = acquireLock(options.cwd);
    reporter.ok('Lock acquired');

    const transaction = loadActiveTransaction(options.cwd);
    if (!transaction) {
      reporter.fail('No interrupted update transaction was found');
      return EXIT_CODES.ROLLBACK;
    }
    if (transaction.status === 'committed' || transaction.status === 'recovered') {
      finishUpdateTransaction(options.cwd, transaction, transaction.status);
      reporter.ok(`Finalized ${transaction.status} update transaction ${transaction.id}`);
      return EXIT_CODES.SUCCESS;
    }

    reporter.stage('Recovering interrupted update', 2, 3);
    const serviceManager = transaction.noRestart ? null : detectServiceManager(options.cwd);
    if (transaction.serviceManagerName && !serviceManager) {
      throw new UpdateError(
        `The interrupted transaction requires ${transaction.serviceManagerName}, but its service configuration cannot be found`,
        'rollback',
        EXIT_CODES.ROLLBACK,
      );
    }

    if (transaction.snapshot) {
      if (!transaction.serviceWasActive && serviceManager) {
        const state = await serviceManager.status();
        if (state !== 'inactive') {
          throw new UpdateError(
            'The service state changed after the interrupted update; refusing to replace code or SQLite',
            'rollback',
            EXIT_CODES.ROLLBACK,
          );
        }
      }
      const result = await rollback(
        options.cwd,
        transaction.serviceWasActive ? serviceManager : null,
        reporter,
        {
          restoreDatabase: transaction.snapshot.kind === 'full',
          snapshot: transaction.snapshot,
          ...(transaction.snapshot.kind === 'partial'
            ? { currentDatabaseSchemaEpoch: transaction.snapshot.databaseSchemaEpoch }
            : {}),
        },
      );
      if (!result.success) {
        throw new UpdateError(
          result.error ?? 'Interrupted update recovery failed',
          'rollback',
          EXIT_CODES.ROLLBACK,
        );
      }
    } else if (transaction.serviceWasActive) {
      if (!serviceManager) {
        throw new UpdateError(
          'The interrupted update stopped a managed service that can no longer be detected',
          'rollback',
          EXIT_CODES.ROLLBACK,
        );
      }
      let state = await serviceManager.status();
      if (state === 'transitioning') {
        state = await waitForServiceState(serviceManager, 'inactive');
      }
      if (state === 'unknown' || state === 'transitioning') {
        throw new UpdateError(
          `Could not determine ${serviceManager.name} service state during recovery`,
          'rollback',
          EXIT_CODES.ROLLBACK,
        );
      }
      if (state === 'inactive') {
        await serviceManager.restart();
        if (await waitForServiceState(serviceManager, 'active') !== 'active') {
          throw new UpdateError(
            `Could not restore ${serviceManager.name} after the interrupted update`,
            'rollback',
            EXIT_CODES.ROLLBACK,
          );
        }
      }
    }

    finishUpdateTransaction(options.cwd, transaction, 'recovered');
    reporter.ok(`Recovered v${transaction.fromVersion} state`);
    retryTarget = transaction.targetTag;
    retryLeaveStopped = transaction.leaveStopped ?? false;
    reporter.stage('Restarting update', 3, 3);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reporter.fail(message);
    writeLastRun(options.cwd, {
      success: false,
      stage: 'rollback',
      error: message,
      exitCode: EXIT_CODES.ROLLBACK,
    });
    return error instanceof UpdateError ? error.exitCode : EXIT_CODES.ROLLBACK;
  } finally {
    if (lease) releaseLock(lease);
  }

  return orchestrate({
    ...options,
    version: retryTarget,
    yes: true,
    rollback: false,
    resume: false,
    status: false,
    leaveStopped: retryLeaveStopped,
  }, reporter);
}

function handleUpdateStatus(options: UpdateOptions, reporter: Reporter): ExitCode {
  try {
    const active = loadActiveTransaction(options.cwd);
    if (active) {
      reporter.info(
        `Update ${active.id}: ${active.status} at ${active.phase} `
        + `(v${active.fromVersion} → v${active.toVersion})`,
      );
      reporter.hint('Run npm run update -- --resume to recover and continue this transaction.');
      return EXIT_CODES.SUCCESS;
    }
    const last = loadLastTransaction(options.cwd);
    if (!last) {
      reporter.info('No updater transaction has been recorded');
      return EXIT_CODES.SUCCESS;
    }
    reporter.info(
      `Last update ${last.id}: ${last.status} at ${last.phase} `
      + `(v${last.fromVersion} → v${last.toVersion})`,
    );
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    reporter.fail(error instanceof Error ? error.message : String(error));
    return EXIT_CODES.ROLLBACK;
  }
}

// ── Manual rollback ──────────────────────────────────────────────────

async function handleManualRollback(
  options: UpdateOptions,
  reporter: Reporter,
): Promise<ExitCode> {
  let lease: MaintenanceLease | null = null;

  try {
    reporter.stage('Acquiring lock', 1, 2);
    lease = acquireLock(options.cwd);
    reporter.ok('Lock acquired');

    if (loadActiveTransaction(options.cwd)) {
      throw new UpdateError(
        'An interrupted update transaction exists; use --resume so its exact snapshot is recovered',
        'rollback',
        EXIT_CODES.ROLLBACK,
      );
    }

    reporter.stage('Rolling back', 2, 2);
    const serviceManager = detectServiceManager(options.cwd);
    const serviceState = serviceManager ? await serviceManager.status() : null;
    if (serviceState === 'unknown' || serviceState === 'transitioning') {
      throw new UpdateError(
        `Could not confirm a stable ${serviceManager?.name} service state; refusing rollback`,
        'rollback',
        EXIT_CODES.ROLLBACK,
      );
    }
    const serviceWasActive = serviceState === 'active';
    const result = await rollback(
      options.cwd,
      serviceWasActive ? serviceManager : null,
      reporter,
      { restoreDatabase: serviceManager !== null },
    );

    if (!serviceManager) {
      reporter.warn('No matching managed service detected — code and environment were restored without replacing SQLite');
      reporter.hint('Restart the manually managed ConvoSketchpad process to load the restored code.');
    }

    if (result.success) {
      reporter.ok(`Rolled back to v${result.snapshot?.version}`);
      return EXIT_CODES.SUCCESS;
    }

    reporter.fail(result.error ?? 'Rollback failed');
    return EXIT_CODES.ROLLBACK;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reporter.fail(message);
    if (err instanceof UpdateError) return err.exitCode;
    return EXIT_CODES.ROLLBACK;
  } finally {
    if (lease) releaseLock(lease);
  }
}

// ── Last run persistence ─────────────────────────────────────────────

function writeLastRun(cwd: string, data: Record<string, unknown>): void {
  try {
    const { lastRunPath } = resolveUpdaterStatePaths(cwd);
    writePrivateJsonAtomic(lastRunPath, { timestamp: Date.now(), ...data });
  } catch {
    // Non-critical — don't let this fail the update
  }
}
