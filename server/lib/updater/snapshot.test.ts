import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { backupSqliteDatabase } from './snapshot.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
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
});
