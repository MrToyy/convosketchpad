/**
 * PID-based maintenance lock shared by setup, migrate, and update.
 */

import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { EXIT_CODES, UpdateError } from './types.js';
import { resolveUpdaterStatePaths } from './state-paths.js';

/**
 * Acquire an exclusive lock. Throws if another live process holds it.
 * Stale locks (dead PID) are automatically cleaned up.
 * Uses `wx` flag for atomic creation to prevent TOCTOU races.
 */
export function acquireLock(cwd: string): string {
  const { stateDir, lockPath } = resolveUpdaterStatePaths(cwd);
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });

  // Attempt atomic exclusive create
  try {
    writeFileSync(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
    return lockPath; // Lock acquired
  } catch (err: unknown) {
    if (!(err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST')) {
      throw err; // Unexpected error
    }
  }

  // Lock file exists — check if holder is still alive
  let raw: string;
  try {
    raw = readFileSync(lockPath, 'utf-8').trim();
  } catch {
    // File disappeared between our failed create and read — retry once
    try {
      writeFileSync(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
      return lockPath;
    } catch {
      throw new UpdateError('Failed to acquire lock', 'lock', EXIT_CODES.LOCK);
    }
  }

  const pid = parseInt(raw, 10);
  if (!isNaN(pid) && isPidAlive(pid)) {
    throw new UpdateError(
      `Another ConvoSketchpad maintenance operation is already running (PID ${pid})`,
      'lock',
      EXIT_CODES.LOCK,
    );
  }

  // Stale lock — previous process died. Remove and re-acquire atomically.
  try { unlinkSync(lockPath); } catch { /* already gone */ }
  try {
    writeFileSync(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
    return lockPath;
  } catch {
    throw new UpdateError('Failed to acquire lock after stale cleanup', 'lock', EXIT_CODES.LOCK);
  }
}

/**
 * Release the lock. Safe to call even if no lock exists.
 */
export function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Already gone — fine.
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
