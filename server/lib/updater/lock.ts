/** Process-bound maintenance lease shared by setup, migrate, and update. */

import {
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { EXIT_CODES, UpdateError } from './types.js';
import { resolveUpdaterStatePaths } from './state-paths.js';

export interface MaintenanceLease {
  schemaVersion: 1;
  path: string;
  token: string;
  pid: number;
  startedAt: number;
  cwd: string;
}

export interface LegacyMaintenanceHandoff {
  protocol: 'v0.4.1';
  path: string;
  pid: number;
  cwd: string;
}

interface LeaseRecord {
  schemaVersion: 1;
  token: string;
  pid: number;
  startedAt: number;
  cwd: string;
}

export function acquireLock(cwd: string): MaintenanceLease {
  const { stateDir, lockPath } = resolveUpdaterStatePaths(cwd);
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const record: LeaseRecord = {
    schemaVersion: 1,
    token: randomBytes(32).toString('hex'),
    pid: process.pid,
    startedAt: Date.now(),
    cwd: resolve(cwd),
  };

  try {
    writeLease(lockPath, record);
    return { ...record, path: lockPath };
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }

  const existing = readLeaseRecord(lockPath);
  if (existing && isPidAlive(existing.pid)) {
    throw new UpdateError(
      `Another ConvoSketchpad maintenance operation is already running (PID ${existing.pid})`,
      'lock',
      EXIT_CODES.LOCK,
    );
  }

  try { unlinkSync(lockPath); } catch { /* already gone */ }
  try {
    writeLease(lockPath, record);
    return { ...record, path: lockPath };
  } catch {
    throw new UpdateError('Failed to acquire maintenance lease after stale cleanup', 'lock', EXIT_CODES.LOCK);
  }
}

export function releaseLock(lease: MaintenanceLease | string): void {
  const path = typeof lease === 'string' ? lease : lease.path;
  if (typeof lease !== 'string') {
    const current = readLeaseRecord(path);
    if (current && current.token !== lease.token) return;
  }
  try { unlinkSync(path); } catch { /* already gone */ }
}

/** Validate that a direct parent still owns the lease named by an inherited nonce. */
export function validateInheritedLease(
  cwd: string,
  token: string,
  expectedParentPid: number = process.ppid,
  inheritedPath?: string,
): MaintenanceLease {
  const lockPath = inheritedPath || resolveUpdaterStatePaths(cwd).lockPath;
  const record = readLeaseRecord(lockPath);
  if (
    !record
    || record.token !== token
    || record.pid !== expectedParentPid
    || record.cwd !== resolve(cwd)
    || !isPidAlive(record.pid)
  ) {
    throw new UpdateError('Inherited maintenance lease is invalid or no longer owned by the parent process', 'lock', EXIT_CODES.LOCK);
  }
  return { ...record, path: lockPath };
}

/**
 * One-release bridge for a target migration process launched by the v0.4.1
 * updater. That updater can pass only boolean flags and a PID-only lock. The
 * flags are trusted only when the exact lock for this installation contains
 * the live direct-parent PID. JSON leases never qualify for this fallback.
 */
export function validateLegacyMaintenanceHandoff(
  cwd: string,
  expectedParentPid: number = process.ppid,
): LegacyMaintenanceHandoff {
  const lockPath = resolveUpdaterStatePaths(cwd).lockPath;
  let raw: string;
  try {
    raw = readFileSync(lockPath, 'utf8').trim();
  } catch {
    throw invalidLegacyHandoff();
  }
  if (!/^\d+$/u.test(raw)) throw invalidLegacyHandoff();
  const pid = Number(raw);
  if (
    !Number.isSafeInteger(pid)
    || pid <= 0
    || pid !== expectedParentPid
    || !isPidAlive(pid)
  ) {
    throw invalidLegacyHandoff();
  }
  return {
    protocol: 'v0.4.1',
    path: lockPath,
    pid,
    cwd: resolve(cwd),
  };
}

export function maintenanceLeaseEnvironment(
  lease: MaintenanceLease,
  databaseOffline: boolean,
): NodeJS.ProcessEnv {
  return {
    CONVOSKETCHPAD_MAINTENANCE_LEASE: lease.token,
    CONVOSKETCHPAD_MAINTENANCE_LEASE_PATH: lease.path,
    ...(databaseOffline ? { CONVOSKETCHPAD_DATABASE_OFFLINE_LEASE: lease.token } : {}),
  };
}

function writeLease(path: string, record: LeaseRecord): void {
  writeFileSync(path, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 });
}

function readLeaseRecord(path: string): LeaseRecord | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LeaseRecord>;
    if (
      parsed.schemaVersion === 1
      && typeof parsed.token === 'string'
      && typeof parsed.pid === 'number'
      && typeof parsed.startedAt === 'number'
      && typeof parsed.cwd === 'string'
    ) return parsed as LeaseRecord;
  } catch {
    // Legacy locks contained only the PID.
  }
  const legacyPid = Number.parseInt(raw, 10);
  return Number.isInteger(legacyPid)
    ? { schemaVersion: 1, token: '', pid: legacyPid, startedAt: 0, cwd: '' }
    : null;
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST');
}

function invalidLegacyHandoff(): UpdateError {
  return new UpdateError(
    'Legacy v0.4.1 maintenance handoff is invalid or not owned by the direct parent process',
    'lock',
    EXIT_CODES.LOCK,
  );
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
