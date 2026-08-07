import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveUpdaterStatePaths } from './state-paths.js';
import {
  advanceUpdateTransaction,
  beginUpdateTransaction,
  finishUpdateTransaction,
  loadActiveTransaction,
  loadLastTransaction,
} from './transaction.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  vi.unstubAllEnvs();
  while (cleanups.length) cleanups.pop()?.();
});

describe('durable updater transaction journal', () => {
  it('persists every phase and atomically archives a committed transaction', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'convosketchpad-transaction-'));
    cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
    vi.stubEnv('CONVOSKETCHPAD_DATA_DIR', join(cwd, 'state'));

    let transaction = beginUpdateTransaction(cwd, {
      tag: 'v0.5.0',
      version: '0.5.0',
      current: '0.4.1',
      isUpToDate: false,
      source: 'release',
    }, false);
    transaction = advanceUpdateTransaction(cwd, transaction, 'service-quiesced', {
      serviceManagerName: 'launchd',
      serviceWasActive: true,
      databaseConfirmedOffline: true,
    });

    expect(loadActiveTransaction(cwd)).toMatchObject({
      id: transaction.id,
      phase: 'service-quiesced',
      serviceWasActive: true,
    });
    finishUpdateTransaction(cwd, transaction, 'committed');
    const paths = resolveUpdaterStatePaths(cwd);
    expect(existsSync(paths.activeTransactionPath)).toBe(false);
    expect(loadLastTransaction(cwd)).toMatchObject({ status: 'committed' });
  });

  it('refuses to overwrite an unfinished transaction', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'convosketchpad-transaction-'));
    cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
    vi.stubEnv('CONVOSKETCHPAD_DATA_DIR', join(cwd, 'state'));
    const resolved = {
      tag: 'v0.5.0',
      version: '0.5.0',
      current: '0.4.1',
      isUpToDate: false,
      source: 'release' as const,
    };
    beginUpdateTransaction(cwd, resolved, false);
    expect(() => beginUpdateTransaction(cwd, resolved, false)).toThrow(/unfinished update transaction/);
  });

  it('fails closed on a malformed recovery record', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'convosketchpad-transaction-'));
    cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
    vi.stubEnv('CONVOSKETCHPAD_DATA_DIR', join(cwd, 'state'));
    const path = resolveUpdaterStatePaths(cwd).activeTransactionPath;
    beginUpdateTransaction(cwd, {
      tag: 'v0.5.0', version: '0.5.0', current: '0.4.1', isUpToDate: false, source: 'release',
    }, false);
    writeFileSync(path, '{broken');
    expect(() => loadActiveTransaction(cwd)).toThrow(/unreadable/);
  });
});
