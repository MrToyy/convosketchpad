/**
 * PID-based file lock for the updater.
 * Prevents concurrent update runs.
 */

import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EXIT_CODES, UpdateError } from './types.js';

const DATA_DIR = process.env.CONVOSKETCHPAD_DATA_DIR || join(homedir(), '.convosketchpad');
const STATE_DIR = join(DATA_DIR, 'updater');
const LOCK_FILE = join(STATE_DIR, 'update.lock');

/**
 * Acquire an exclusive lock. Throws if another live process holds it.
 * Stale locks (dead PID) are automatically cleaned up.
 * Uses `wx` flag for atomic creation to prevent TOCTOU races.
 */
export function acquireLock(): void {
  mkdirSync(STATE_DIR, { recursive: true });

  // Attempt atomic exclusive create
  try {
    writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return; // Lock acquired
  } catch (err: unknown) {
    if (!(err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST')) {
      throw err; // Unexpected error
    }
  }

  // Lock file exists — check if holder is still alive
  let raw: string;
  try {
    raw = readFileSync(LOCK_FILE, 'utf-8').trim();
  } catch {
    // File disappeared between our failed create and read — retry once
    try {
      writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
      return;
    } catch {
      throw new UpdateError('Failed to acquire lock', 'lock', EXIT_CODES.LOCK);
    }
  }

  const pid = parseInt(raw, 10);
  if (!isNaN(pid) && isPidAlive(pid)) {
    throw new UpdateError(
      `Another update is already running (PID ${pid})`,
      'lock',
      EXIT_CODES.LOCK,
    );
  }

  // Stale lock — previous process died. Remove and re-acquire atomically.
  try { unlinkSync(LOCK_FILE); } catch { /* already gone */ }
  try {
    writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
  } catch {
    throw new UpdateError('Failed to acquire lock after stale cleanup', 'lock', EXIT_CODES.LOCK);
  }
}

/**
 * Release the lock. Safe to call even if no lock exists.
 */
export function releaseLock(): void {
  try {
    unlinkSync(LOCK_FILE);
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
