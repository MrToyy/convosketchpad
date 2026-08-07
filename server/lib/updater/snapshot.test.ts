import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backupSqliteDatabase, createSnapshot, restoreSnapshotEnvironment } from './snapshot.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  vi.unstubAllEnvs();
  while (cleanups.length) cleanups.pop()?.();
});

describe('updater database snapshots', () => {
  it('creates a consistent standalone SQLite backup including WAL data', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-updater-snapshot-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const sourcePath = path.join(dir, 'source.sqlite');
    const backupPath = path.join(dir, 'backup.sqlite');
    const source = new DatabaseSync(sourcePath);
    source.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE records(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO records VALUES ('one', 'persisted');`);

    backupSqliteDatabase(sourcePath, backupPath);
    source.close();

    const backup = new DatabaseSync(backupPath, { readOnly: true });
    expect(backup.prepare('SELECT * FROM records').all()).toEqual([
      { id: 'one', value: 'persisted' },
    ]);
    expect(backup.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    backup.close();
    expect(statSync(backupPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(backupPath).byteLength).toBeGreaterThan(0);
  });

  it('restores the absence of an environment file from the snapshot ledger', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-updater-env-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const envPath = path.join(dir, '.env');
    writeFileSync(envPath, 'AGENT_RUNTIMES=openclaw\n');

    restoreSnapshotEnvironment(dir, {
      ref: 'ref',
      version: '0.4.0',
      timestamp: 1,
      envHash: '',
      environmentExisted: false,
    });

    expect(existsSync(envPath)).toBe(false);
  });

  it('does not open SQLite or replace last-good when those snapshot features are disabled', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-updater-online-'));
    const dataDir = path.join(dir, 'state');
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    vi.stubEnv('CONVOSKETCHPAD_DATA_DIR', dataDir);
    writeFileSync(path.join(dir, 'package.json'), '{"version":"0.4.0"}\n');
    mkdirSync(path.join(dir, 'database'));
    writeFileSync(path.join(dir, 'database/canvas.sqlite'), 'not a sqlite database');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Snapshot Test'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'snapshot@example.test'], { cwd: dir });
    execFileSync('git', ['add', 'package.json'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: dir });
    const ledgerPath = path.join(dataDir, 'updater/last-good.json');
    mkdirSync(path.dirname(ledgerPath), { recursive: true });
    writeFileSync(ledgerPath, '{"sentinel":true}\n');

    const snapshot = createSnapshot(dir, { includeDatabase: false, recordLastGood: false });

    expect(snapshot.databaseExisted).toBeUndefined();
    expect(snapshot.databaseBackupPath).toBeUndefined();
    expect(readFileSync(ledgerPath, 'utf-8')).toBe('{"sentinel":true}\n');
  });

  it('creates a transient setup database snapshot without requiring Git metadata', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-setup-snapshot-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    vi.stubEnv('CONVOSKETCHPAD_DATA_DIR', path.join(dir, 'state'));
    mkdirSync(path.join(dir, 'database'));
    const database = new DatabaseSync(path.join(dir, 'database/canvas.sqlite'));
    database.exec('CREATE TABLE fixture(id INTEGER PRIMARY KEY)');
    database.close();

    const snapshot = createSnapshot(dir, {
      includeCodeMetadata: false,
      includeEnvironment: false,
      recordLastGood: false,
    });

    expect(snapshot.ref).toBe('');
    expect(snapshot.version).toBe('');
    expect(snapshot.databaseBackupPath && existsSync(snapshot.databaseBackupPath)).toBe(true);
  });
});
