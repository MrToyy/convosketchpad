import { existsSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  ResolvedVersion,
  Snapshot,
  UpdateTransaction,
  UpdateTransactionPhase,
} from './types.js';
import { resolveUpdaterStatePaths } from './state-paths.js';
import { writePrivateJsonAtomic } from './state-file.js';

export function beginUpdateTransaction(
  cwd: string,
  resolved: ResolvedVersion,
  noRestart: boolean,
  leaveStopped: boolean = false,
): UpdateTransaction {
  if (loadActiveTransaction(cwd)) {
    throw new Error('An unfinished update transaction already exists; run npm run update -- --resume');
  }
  const now = Date.now();
  const transaction: UpdateTransaction = {
    schemaVersion: 1,
    id: randomUUID(),
    pid: process.pid,
    startedAt: now,
    updatedAt: now,
    status: 'in-progress',
    phase: 'resolved',
    fromVersion: resolved.current,
    toVersion: resolved.version,
    targetTag: resolved.tag,
    noRestart,
    leaveStopped,
    databaseConfirmedOffline: false,
  };
  persistActiveTransaction(cwd, transaction);
  return transaction;
}

export function advanceUpdateTransaction(
  cwd: string,
  transaction: UpdateTransaction,
  phase: UpdateTransactionPhase,
  patch: Partial<Pick<
    UpdateTransaction,
    | 'serviceManagerName'
    | 'serviceWasActive'
    | 'databaseConfirmedOffline'
    | 'snapshot'
  >> = {},
): UpdateTransaction {
  const next: UpdateTransaction = {
    ...transaction,
    ...patch,
    phase,
    status: 'in-progress',
    pid: process.pid,
    updatedAt: Date.now(),
    error: undefined,
  };
  persistActiveTransaction(cwd, next);
  return next;
}

export function failUpdateTransaction(
  cwd: string,
  transaction: UpdateTransaction,
  error: string,
): UpdateTransaction {
  const failed: UpdateTransaction = {
    ...transaction,
    status: 'failed',
    pid: process.pid,
    updatedAt: Date.now(),
    error,
  };
  persistActiveTransaction(cwd, failed);
  return failed;
}

export function finishUpdateTransaction(
  cwd: string,
  transaction: UpdateTransaction,
  status: 'committed' | 'recovered',
): UpdateTransaction {
  const state = resolveUpdaterStatePaths(cwd);
  const finished: UpdateTransaction = {
    ...transaction,
    status,
    pid: process.pid,
    updatedAt: Date.now(),
    error: undefined,
  };
  // Mark the active record terminal before archiving it. If the process dies
  // between these writes, the next updater can finalize instead of rolling a
  // successfully committed update back.
  writePrivateJsonAtomic(state.activeTransactionPath, finished);
  writePrivateJsonAtomic(state.lastTransactionPath, finished);
  rmSync(state.activeTransactionPath, { force: true });
  return finished;
}

export function loadActiveTransaction(cwd: string): UpdateTransaction | null {
  return readTransaction(resolveUpdaterStatePaths(cwd).activeTransactionPath);
}

export function loadLastTransaction(cwd: string): UpdateTransaction | null {
  return readTransaction(resolveUpdaterStatePaths(cwd).lastTransactionPath);
}

export function attachTransactionSnapshot(
  cwd: string,
  transaction: UpdateTransaction,
  snapshot: Snapshot,
): UpdateTransaction {
  return advanceUpdateTransaction(cwd, transaction, 'snapshot-created', {
    snapshot,
    databaseConfirmedOffline: snapshot.kind === 'full',
  });
}

function persistActiveTransaction(cwd: string, transaction: UpdateTransaction): void {
  writePrivateJsonAtomic(resolveUpdaterStatePaths(cwd).activeTransactionPath, transaction);
}

function readTransaction(path: string): UpdateTransaction | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<UpdateTransaction>;
    if (
      parsed.schemaVersion !== 1
      || typeof parsed.id !== 'string'
      || typeof parsed.phase !== 'string'
      || typeof parsed.fromVersion !== 'string'
      || typeof parsed.toVersion !== 'string'
      || typeof parsed.targetTag !== 'string'
    ) {
      throw new Error('invalid transaction record');
    }
    return parsed as UpdateTransaction;
  } catch (error) {
    throw new Error(
      `Updater transaction record is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
