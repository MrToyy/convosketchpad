import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApplicationContext } from './application-context.js';

describe('ApplicationContext', () => {
  it('owns distinct Store and Runtime adapter instances', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'convosketchpad-context-'));
    const first = createApplicationContext({
      databasePath: path.join(root, 'first.sqlite'),
      runtimeIds: ['openclaw'],
    });
    const second = createApplicationContext({
      databasePath: path.join(root, 'second.sqlite'),
      runtimeIds: ['openclaw'],
    });
    try {
      expect(first.store).not.toBe(second.store);
      expect(first.runtimes.get('openclaw')).not.toBe(second.runtimes.get('openclaw'));
      first.store.ensureUser('first-owner', 'First');
      expect(second.store.db.prepare('SELECT COUNT(*) AS count FROM canvas_users').get())
        .toEqual({ count: 0 });
    } finally {
      first.close();
      second.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
