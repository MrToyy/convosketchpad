/**
 * Snapshot management — save/restore last-known-good state.
 * Preserves git ref, version, env hash, and a copy of .env.
 */

import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import type { Snapshot } from './types.js';

const DATA_DIR = process.env.CONVOSKETCHPAD_DATA_DIR || join(homedir(), '.convosketchpad');
const STATE_DIR = join(DATA_DIR, 'updater');
const LAST_GOOD_PATH = join(STATE_DIR, 'last-good.json');

/**
 * Create a snapshot of the current state before updating.
 * Saves git ref + version + env hash, and copies .env to a timestamped dir.
 */
export function createSnapshot(cwd: string): Snapshot {
  const ref = execSync('git rev-parse HEAD', { cwd, stdio: 'pipe' }).toString().trim();

  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')) as { version: string };
  const version = pkg.version;
  const timestamp = Date.now();

  // Hash .env if it exists (never overwrite it — just back it up)
  let envHash = '';
  const envPath = join(cwd, '.env');
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8');
    envHash = createHash('sha256').update(envContent).digest('hex');

    const snapshotDir = join(STATE_DIR, 'snapshots', String(timestamp));
    mkdirSync(snapshotDir, { recursive: true, mode: 0o700 });
    const backupPath = join(snapshotDir, '.env');
    copyFileSync(envPath, backupPath);
    chmodSync(backupPath, 0o600);
  }

  const snapshot: Snapshot = { ref, version, timestamp, envHash };

  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(LAST_GOOD_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');

  return snapshot;
}

/**
 * Load the last-good snapshot, or null if none exists.
 */
export function loadSnapshot(): Snapshot | null {
  if (!existsSync(LAST_GOOD_PATH)) return null;

  try {
    return JSON.parse(readFileSync(LAST_GOOD_PATH, 'utf-8')) as Snapshot;
  } catch {
    return null;
  }
}
