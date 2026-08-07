/**
 * Snapshot management — save/restore last-known-good state.
 * Preserves git ref, version, env hash, and a copy of .env.
 */

import {
  readFileSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  existsSync,
  rmSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import type { Snapshot } from './types.js';
import { resolveUpdaterStatePaths } from './state-paths.js';
import { writePrivateJsonAtomic } from './state-file.js';
import { loadReleaseCompatibility } from './compatibility.js';

export interface CreateSnapshotOptions {
  includeCodeMetadata?: boolean;
  includeEnvironment?: boolean;
  includeDatabase?: boolean;
  recordLastGood?: boolean;
}

export interface SqliteBackupVerification {
  size: number;
  sha256: string;
}

export function backupSqliteDatabase(
  databasePath: string,
  backupPath: string,
): SqliteBackupVerification {
  const database = new DatabaseSync(databasePath);
  try {
    const escaped = backupPath.replaceAll("'", "''");
    database.exec(`VACUUM INTO '${escaped}'`);
  } finally {
    database.close();
  }
  chmodSync(backupPath, 0o600);
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const integrity = backup.prepare('PRAGMA integrity_check').get() as { integrity_check?: string };
    if (integrity.integrity_check !== 'ok') throw new Error('SQLite snapshot integrity check failed');
    const foreignKeyFailures = backup.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyFailures.length > 0) {
      throw new Error(`SQLite snapshot foreign-key check failed (${foreignKeyFailures.length} row(s))`);
    }
  } finally {
    backup.close();
  }
  return {
    size: statSync(backupPath).size,
    sha256: sha256File(backupPath),
  };
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
  if (recordLastGood && !includeDatabase) {
    throw new Error('A partial snapshot cannot replace the last-known-good rollback point');
  }
  const state = resolveUpdaterStatePaths(cwd);
  const ref = includeCodeMetadata
    ? execSync('git rev-parse HEAD', { cwd, stdio: 'pipe' }).toString().trim()
    : '';
  const version = includeCodeMetadata
    ? (JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')) as { version: string }).version
    : '';
  const compatibility = includeCodeMetadata
    ? loadReleaseCompatibility(cwd, version)
    : undefined;
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
  let databaseVerification: SqliteBackupVerification | undefined;
  if (databaseExisted === true) {
    databaseBackupPath = join(snapshotDir, 'canvas.sqlite');
    databaseVerification = backupSqliteDatabase(databasePath, databaseBackupPath);
  }

  const snapshot: Snapshot = {
    kind: includeDatabase ? 'full' : 'partial',
    ref,
    version,
    timestamp,
    envHash,
    ...(compatibility ? {
      databaseSchemaEpoch: compatibility.databaseSchemaEpoch,
      minimumReadableDatabaseSchemaEpoch: compatibility.minimumReadableDatabaseSchemaEpoch,
      maximumReadableDatabaseSchemaEpoch: compatibility.maximumReadableDatabaseSchemaEpoch,
    } : {}),
    snapshotDir,
    ...(environmentExisted !== undefined ? { environmentExisted } : {}),
    ...(environmentBackupPath ? { environmentBackupPath } : {}),
    ...(databaseExisted !== undefined ? { databaseExisted } : {}),
    ...(databaseBackupPath ? { databaseBackupPath } : {}),
    ...(databaseVerification ? {
      databaseBackupSize: databaseVerification.size,
      databaseBackupSha256: databaseVerification.sha256,
      databaseIntegrityVerified: true,
    } : {}),
  };

  if (recordLastGood) {
    mkdirSync(state.stateDir, { recursive: true, mode: 0o700 });
    writePrivateJsonAtomic(state.lastGoodPath, snapshot);
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
  if (snapshot.kind !== 'full' || snapshot.databaseExisted === undefined) {
    throw new Error('A complete database snapshot is required for database rollback');
  }
  const databasePath = join(cwd, 'database', 'canvas.sqlite');
  if (!snapshot.databaseExisted) {
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    rmSync(databasePath, { force: true });
    return;
  }
  if (!snapshot.databaseBackupPath) throw new Error('Database snapshot is missing');
  const stateRoot = `${resolve(resolveUpdaterStatePaths(cwd).stateDir)}${sep}`;
  const backupPath = resolve(snapshot.databaseBackupPath);
  if (!backupPath.startsWith(stateRoot) || !existsSync(backupPath)) {
    throw new Error('Database snapshot path is invalid or missing');
  }
  if (
    snapshot.databaseBackupSize !== undefined
    && statSync(backupPath).size !== snapshot.databaseBackupSize
  ) {
    throw new Error('Database snapshot size does not match its verified manifest');
  }
  if (snapshot.databaseBackupSha256) {
    const actualHash = sha256File(backupPath);
    if (actualHash !== snapshot.databaseBackupSha256) {
      throw new Error('Database snapshot hash does not match its verified manifest');
    }
  }
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
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
    return normalizeSnapshot(JSON.parse(readFileSync(lastGoodPath, 'utf-8')) as Snapshot);
  } catch {
    return null;
  }
}

/** Read legacy ledgers conservatively while making completeness explicit. */
export function normalizeSnapshot(snapshot: Snapshot): Snapshot {
  if (snapshot.kind === 'full' || snapshot.kind === 'partial') return snapshot;
  return {
    ...snapshot,
    kind: snapshot.databaseExisted === undefined ? 'partial' : 'full',
  };
}

function sha256File(path: string): string {
  const hash = createHash('sha256');
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
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
