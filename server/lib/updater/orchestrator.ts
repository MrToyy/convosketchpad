/**
 * Update orchestrator — the state machine that wires all modules together.
 *
 * Flow: lock → preflight → resolve → confirm → snapshot → update → build
 *       → restart → health → commit/rollback → unlock
 */

import { chmodSync, writeFileSync, mkdirSync } from 'node:fs';
import { acquireLock, releaseLock } from './lock.js';
import { runPreflight } from './preflight.js';
import { resolveVersion } from './release-resolver.js';
import { createSnapshot } from './snapshot.js';
import {
  gitFetchAndCheckout,
  buildProject,
  migrateDatabase,
  migrateEnvironment,
} from './installer.js';
import { detectServiceManager } from './service-manager.js';
import { checkHealth, resolveHealthCheckBaseUrl } from './health.js';
import { rollback } from './rollback.js';
import { EXIT_CODES, UpdateError } from './types.js';
import type { UpdateOptions, Reporter, ExitCode, ServiceManager } from './types.js';
import { resolveUpdaterStatePaths } from './state-paths.js';

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/**
 * Run the full update flow. Returns an exit code.
 * All terminal output goes through the reporter.
 */
export async function orchestrate(options: UpdateOptions, reporter: Reporter): Promise<ExitCode> {
  if (options.rollback) {
    return handleManualRollback(options, reporter);
  }

  // Calculate total stages dynamically based on which stages will actually run
  // lock + preflight + resolve + snapshot + update + build + environment migration = 7 stages
  // + confirm (only if not --yes) + migrate + restart + health (unless --no-restart)
  const totalStages = 7 + (options.yes ? 0 : 1) + (options.noRestart ? 0 : 3);
  let stageNum = 0;
  let lockPath: string | null = null;
  let serviceManager: ServiceManager | null = null;
  let serviceWasActive = false;
  let databaseConfirmedOffline = false;
  let snapshotCreated = false;

  try {
    // ── 1. Lock ────────────────────────────────────────────────────
    stageNum++;
    reporter.stage('Acquiring lock', stageNum, totalStages);
    lockPath = acquireLock(options.cwd);
    reporter.ok('Lock acquired');

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
        reporter.dry('Would restore the service to its previous running/stopped state');
        reporter.dry('Would run health checks only for a previously active service');
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

    // ── 5. Snapshot ────────────────────────────────────────────────
    stageNum++;
    reporter.stage('Creating snapshot', stageNum, totalStages);
    serviceManager = options.noRestart ? null : detectServiceManager(options.cwd);
    if (!options.noRestart && serviceManager) {
      const serviceState = await serviceManager.status();
      if (serviceState === 'unknown') {
        throw new UpdateError(
          `Could not determine ${serviceManager.name} service state; refusing to snapshot or migrate SQLite`,
          'snapshot',
          EXIT_CODES.BUILD,
        );
      }
      serviceWasActive = serviceState === 'active';
      databaseConfirmedOffline = serviceState === 'inactive';
    }
    if (!options.noRestart && serviceManager && serviceWasActive) {
      reporter.verbose(`Stopping service via ${serviceManager.name} before database snapshot`);
      try {
        await serviceManager.stop();
        if (await serviceManager.status() !== 'inactive') {
          throw new Error('service did not reach the inactive state');
        }
        databaseConfirmedOffline = true;
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
    let snapshot: ReturnType<typeof createSnapshot>;
    try {
      snapshot = createSnapshot(options.cwd, {
        includeDatabase: databaseConfirmedOffline,
      });
    } catch (error) {
      if (!options.noRestart && serviceManager && serviceWasActive) {
        try {
          await serviceManager.restart();
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
    snapshotCreated = true;
    reporter.ok(`Snapshot saved (ref: ${snapshot.ref.slice(0, 8)})`);

    // ── 6. Update (git checkout) ───────────────────────────────────
    stageNum++;
    reporter.stage('Updating', stageNum, totalStages);
    reporter.verbose(`Fetch and validate official release ${resolved.tag}`);
    gitFetchAndCheckout(options.cwd, resolved.tag);
    reporter.ok(`Checked out ${resolved.tag}`);

    // ── 7. Build ───────────────────────────────────────────────────
    stageNum++;
    reporter.stage('Building', stageNum, totalStages);
    reporter.verbose('npm ci && npm run build');
    buildProject(options.cwd);
    reporter.ok('Build complete');

    stageNum++;
    reporter.stage('Migrating configuration', stageNum, totalStages);
    migrateEnvironment(options.cwd);
    reporter.ok('Agent Runtime configuration migration complete');

    // ── 9–11. Database migrate + restart + health (unless --no-restart) ─────
    if (!options.noRestart) {
      stageNum++;
      reporter.stage('Migrating database', stageNum, totalStages);
      if (databaseConfirmedOffline) {
        migrateDatabase(options.cwd);
        reporter.ok('Database migration complete');
      } else {
        reporter.warn('No managed service detected — deferring database migration');
        reporter.hint('The target server will migrate the database on its next manual start.');
      }

      stageNum++;
      reporter.stage('Restarting service', stageNum, totalStages);

      if (serviceManager && serviceWasActive) {
        reporter.verbose(`Detected ${serviceManager.name}`);
        try {
          await serviceManager.restart();
          // Give the service a moment to stabilize before checking
          await sleep(2000);
          let state = await serviceManager.status();
          if (state !== 'active') {
            // Retry once after another short delay (systemd may show "activating")
            await sleep(2000);
            state = await serviceManager.status();
          }
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
      } else if (serviceManager) {
        reporter.ok(`Service remains stopped via ${serviceManager.name} (matching its pre-update state)`);
      } else {
        reporter.warn('No service manager detected — skipping restart');
        reporter.hint('Start the server manually:');
        reporter.cmd('npm start');
      }

      stageNum++;
      reporter.stage('Health check', stageNum, totalStages);
      if (serviceManager && serviceWasActive) {
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
      } else if (serviceManager) {
        reporter.warn('Skipped — service was not running before the update');
      } else {
        reporter.warn('Skipped — no managed service is available to verify');
      }
    }

    // ── Success ────────────────────────────────────────────────────
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
      snapshotCreated,
      reporter,
    );
  } finally {
    if (lockPath) releaseLock(lockPath);
  }
}

// ── Failure handler ──────────────────────────────────────────────────

async function handleFailure(
  err: unknown,
  options: UpdateOptions,
  serviceManager: ServiceManager | null,
  serviceWasActive: boolean,
  databaseConfirmedOffline: boolean,
  snapshotCreated: boolean,
  reporter: Reporter,
): Promise<ExitCode> {
  const isUpdateError = err instanceof UpdateError;
  const stage = isUpdateError ? err.stage : 'unknown';
  const message = err instanceof Error ? err.message : String(err);
  let exitCode: ExitCode = isUpdateError ? err.exitCode : EXIT_CODES.BUILD;

  reporter.fail(`Failed at stage: ${stage}`);
  reporter.fail(message);

  // Attempt rollback if we had a snapshot and the failure was after snapshot
  const rollbackStages = new Set(['update', 'build', 'migrate', 'restart', 'health']);
  if (snapshotCreated && rollbackStages.has(stage)) {
    reporter.info('Attempting rollback...');
    const result = await rollback(
      options.cwd,
      serviceWasActive ? serviceManager : null,
      reporter,
      { restoreDatabase: databaseConfirmedOffline && !options.noRestart },
    );

    if (result.success) {
      reporter.warn(`Rolled back to v${result.snapshot?.version}`);
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

// ── Manual rollback ──────────────────────────────────────────────────

async function handleManualRollback(
  options: UpdateOptions,
  reporter: Reporter,
): Promise<ExitCode> {
  let lockPath: string | null = null;

  try {
    reporter.stage('Acquiring lock', 1, 2);
    lockPath = acquireLock(options.cwd);
    reporter.ok('Lock acquired');

    reporter.stage('Rolling back', 2, 2);
    const serviceManager = detectServiceManager(options.cwd);
    const serviceState = serviceManager ? await serviceManager.status() : null;
    if (serviceState === 'unknown') {
      throw new UpdateError(
        `Could not determine ${serviceManager?.name} service state; refusing rollback`,
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
    if (lockPath) releaseLock(lockPath);
  }
}

// ── Last run persistence ─────────────────────────────────────────────

function writeLastRun(cwd: string, data: Record<string, unknown>): void {
  try {
    const { stateDir, lastRunPath } = resolveUpdaterStatePaths(cwd);
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      lastRunPath,
      JSON.stringify({ timestamp: Date.now(), ...data }, null, 2),
      { encoding: 'utf-8', mode: 0o600 },
    );
    chmodSync(lastRunPath, 0o600);
  } catch {
    // Non-critical — don't let this fail the update
  }
}
