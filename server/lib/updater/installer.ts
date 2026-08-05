/** Exact release checkout, deterministic install, and build helpers. */

import { execFileSync } from 'node:child_process';
import { EXIT_CODES, UpdateError } from './types.js';

const EXEC_TIMEOUT = 300_000;
export const MIGRATION_TIMEOUT = 60 * 60 * 1_000;
const RELEASE_TAG_REGEX = /^v(\d+\.\d+\.\d+)$/;
const RELEASE_REF_PREFIX = 'refs/convosketchpad/releases';

/**
 * Fetch one official release tag into an internal ref, validate its package
 * identity, then check it out in detached-HEAD mode.
 */
export function gitFetchAndCheckout(cwd: string, tag: string): void {
  const match = RELEASE_TAG_REGEX.exec(tag);
  if (!match) {
    throw new UpdateError(
      `Invalid release tag ${tag}`,
      'update',
      EXIT_CODES.BUILD,
    );
  }

  const expectedVersion = match[1];
  const releaseRef = `${RELEASE_REF_PREFIX}/${tag}`;

  try {
    execFileSync(
      'git',
      ['fetch', '--no-tags', 'origin', `refs/tags/${tag}:${releaseRef}`],
      { cwd, stdio: 'pipe', timeout: EXEC_TIMEOUT },
    );
  } catch (err) {
    throw new UpdateError(
      `git fetch ${tag} failed: ${errorMessage(err)}`,
      'update',
      EXIT_CODES.BUILD,
    );
  }

  validateReleaseManifest(cwd, releaseRef, expectedVersion);

  try {
    execFileSync(
      'git',
      ['checkout', '--force', '--detach', releaseRef],
      { cwd, stdio: 'pipe', timeout: EXEC_TIMEOUT },
    );
  } catch (err) {
    throw new UpdateError(
      `git checkout ${tag} failed: ${errorMessage(err)}`,
      'update',
      EXIT_CODES.BUILD,
    );
  }
}

function validateReleaseManifest(cwd: string, releaseRef: string, expectedVersion: string): void {
  try {
    const raw = execFileSync(
      'git',
      ['show', `${releaseRef}:package.json`],
      { cwd, stdio: 'pipe', timeout: EXEC_TIMEOUT },
    ).toString();
    const pkg = JSON.parse(raw) as { name?: string; version?: string };
    if (pkg.name !== 'convosketchpad' || pkg.version !== expectedVersion) {
      throw new Error(
        `expected convosketchpad@${expectedVersion}, found ${pkg.name ?? 'unknown'}@${pkg.version ?? 'unknown'}`,
      );
    }
  } catch (err) {
    throw new UpdateError(
      `Release package validation failed: ${errorMessage(err)}`,
      'update',
      EXIT_CODES.BUILD,
    );
  }
}

/** Checkout a saved local commit without fetching. Used for rollback. */
export function gitCheckoutLocal(cwd: string, ref: string): void {
  try {
    execFileSync(
      'git',
      ['checkout', '--force', '--detach', ref],
      { cwd, stdio: 'pipe', timeout: EXEC_TIMEOUT },
    );
  } catch (err) {
    throw new UpdateError(
      `git checkout ${ref} failed: ${errorMessage(err)}`,
      'rollback',
      EXIT_CODES.ROLLBACK,
    );
  }
}

/** Install the lockfile exactly and run the complete project build once. */
export function buildProject(cwd: string): void {
  const steps: Array<{ command: string; args: string[]; label: string }> = [
    { command: 'npm', args: ['ci'], label: 'npm ci failed' },
    { command: 'npm', args: ['run', 'build'], label: 'Build failed' },
  ];

  for (const step of steps) {
    try {
      execFileSync(step.command, step.args, {
        cwd,
        stdio: 'pipe',
        timeout: EXEC_TIMEOUT,
      });
    } catch (err) {
      throw new UpdateError(
        `${step.label}: ${errorMessage(err)}`,
        'build',
        EXIT_CODES.BUILD,
      );
    }
  }
}

export function migrateDatabase(cwd: string): void {
  try {
    execFileSync(
      process.execPath,
      ['bin-dist/bin/convosketchpad-migrate.js'],
      {
        cwd,
        stdio: 'pipe',
        timeout: MIGRATION_TIMEOUT,
        env: {
          ...process.env,
          CONVOSKETCHPAD_MAINTENANCE_LOCK_HELD: '1',
          CONVOSKETCHPAD_DATABASE_OFFLINE: '1',
        },
      },
    );
  } catch (err) {
    throw new UpdateError(
      `Database migration failed: ${errorMessage(err)}`,
      'migrate',
      EXIT_CODES.MIGRATION,
    );
  }
}

export function migrateEnvironment(cwd: string): void {
  try {
    execFileSync(
      process.execPath,
      ['bin-dist/bin/convosketchpad-migrate.js', '--env-only'],
      {
        cwd,
        stdio: 'pipe',
        timeout: MIGRATION_TIMEOUT,
        env: { ...process.env, CONVOSKETCHPAD_MAINTENANCE_LOCK_HELD: '1' },
      },
    );
  } catch (err) {
    throw new UpdateError(
      `Environment migration failed: ${errorMessage(err)}`,
      'migrate',
      EXIT_CODES.MIGRATION,
    );
  }
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = (err as { stderr: Buffer | string }).stderr;
    const text = Buffer.isBuffer(stderr) ? stderr.toString().trim() : String(stderr).trim();
    if (text) return text;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
