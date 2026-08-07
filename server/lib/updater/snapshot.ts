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
  rmSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import type { Snapshot } from './types.js';
import { resolveUpdaterStatePaths } from './state-paths.js';

export interface CreateSnapshotOptions {
  includeCodeMetadata?: boolean;
  includeEnvironment?: boolean;
  includeDatabase?: boolean;
  recordLastGood?: boolean;
}

export function backupSqliteDatabase(databasePath: string, backupPath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    const escaped = backupPath.replaceAll("'", "''");
    database.exec(`VACUUM INTO '${escaped}'`);
  } finally {
    database.close();
  }
  chmodSync(backupPath, 0o600);
}

/**
 * Create a snapshot of the current state before updating.
 * Saves git ref + version + env hash, and copies .env to a timestamped dir.
 */
export function createSnapshot(cwd: string, options: CreateSnapshotOptions = {}): Snapshot {
  const {
    includeCodeMetadata = true,
    includeEnvironment = true,
    includeDatabase = true,
    recordLastGood = true,
  } = options;
  const state = resolveUpdaterStatePaths(cwd);
  const ref = includeCodeMetadata
    ? execSync('git rev-parse HEAD', { cwd, stdio: 'pipe' }).toString().trim()
    : '';
  const version = includeCodeMetadata
    ? (JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')) as { version: string }).version
    : '';
  const timestamp = Date.now();
  const snapshotDir = join(state.snapshotsDir, String(timestamp));
  mkdirSync(snapshotDir, { recursive: true, mode: 0o700 });

  // Hash .env if it exists (never overwrite it — just back it up)
  let envHash = '';
  const envPath = join(cwd, '.env');
  const environmentExisted = includeEnvironment ? existsSync(envPath) : undefined;
  let environmentBackupPath: string | undefined;
  if (environmentExisted === true) {
    const envContent = readFileSync(envPath, 'utf-8');
    envHash = createHash('sha256').update(envContent).digest('hex');

    environmentBackupPath = join(snapshotDir, '.env');
    copyFileSync(envPath, environmentBackupPath);
    chmodSync(environmentBackupPath, 0o600);
  }

  const databasePath = join(cwd, 'database', 'canvas.sqlite');
  const databaseExisted = includeDatabase ? existsSync(databasePath) : undefined;
  let databaseBackupPath: string | undefined;
  if (databaseExisted === true) {
    databaseBackupPath = join(snapshotDir, 'canvas.sqlite');
    backupSqliteDatabase(databasePath, databaseBackupPath);
  }

  const snapshot: Snapshot = {
    ref,
    version,
    timestamp,
    envHash,
    snapshotDir,
    ...(environmentExisted !== undefined ? { environmentExisted } : {}),
    ...(environmentBackupPath ? { environmentBackupPath } : {}),
    ...(databaseExisted !== undefined ? { databaseExisted } : {}),
    ...(databaseBackupPath ? { databaseBackupPath } : {}),
  };

  if (recordLastGood) {
    mkdirSync(state.stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(state.lastGoodPath, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
    chmodSync(state.lastGoodPath, 0o600);
  }

  return snapshot;
}

export function restoreSnapshotEnvironment(cwd: string, snapshot: Snapshot): void {
  if (snapshot.environmentExisted === undefined) return;
  const envPath = join(cwd, '.env');
  if (!snapshot.environmentExisted) {
    rmSync(envPath, { force: true });
    return;
  }
  if (!snapshot.environmentBackupPath) throw new Error('Environment snapshot is missing');
  const stateRoot = `${resolve(resolveUpdaterStatePaths(cwd).stateDir)}${sep}`;
  const backupPath = resolve(snapshot.environmentBackupPath);
  if (!backupPath.startsWith(stateRoot) || !existsSync(backupPath)) {
    throw new Error('Environment snapshot path is invalid or missing');
  }
  copyFileSync(backupPath, envPath);
  chmodSync(envPath, 0o600);
}

export function restoreSnapshotDatabase(cwd: string, snapshot: Snapshot): void {
  if (snapshot.databaseExisted === undefined) return;
  const databasePath = join(cwd, 'database', 'canvas.sqlite');
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  if (!snapshot.databaseExisted) {
    rmSync(databasePath, { force: true });
    return;
  }
  if (!snapshot.databaseBackupPath) throw new Error('Database snapshot is missing');
  const stateRoot = `${resolve(resolveUpdaterStatePaths(cwd).stateDir)}${sep}`;
  const backupPath = resolve(snapshot.databaseBackupPath);
  if (!backupPath.startsWith(stateRoot) || !existsSync(backupPath)) {
    throw new Error('Database snapshot path is invalid or missing');
  }
  mkdirSync(join(cwd, 'database'), { recursive: true });
  copyFileSync(backupPath, databasePath);
  chmodSync(databasePath, 0o600);
}

/**
 * Load the last-good snapshot, or null if none exists.
 */
export function loadSnapshot(cwd: string): Snapshot | null {
  const { lastGoodPath } = resolveUpdaterStatePaths(cwd);
  if (!existsSync(lastGoodPath)) return null;

  try {
    return JSON.parse(readFileSync(lastGoodPath, 'utf-8')) as Snapshot;
  } catch {
    return null;
  }
}

/** Remove a transient snapshot after its caller no longer needs it. */
export function discardSnapshot(cwd: string, snapshot: Snapshot): void {
  const snapshotDir = snapshot.snapshotDir
    || (snapshot.databaseBackupPath ? dirname(snapshot.databaseBackupPath) : undefined)
    || (snapshot.environmentBackupPath ? dirname(snapshot.environmentBackupPath) : undefined);
  if (!snapshotDir) return;
  const snapshotsRoot = `${resolve(resolveUpdaterStatePaths(cwd).snapshotsDir)}${sep}`;
  const target = resolve(snapshotDir);
  if (!target.startsWith(snapshotsRoot)) {
    throw new Error('Snapshot path is outside the updater state directory');
  }
  rmSync(target, { recursive: true, force: true });
}
