import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireLock, releaseLock } from './lock.js';

describe('maintenance lock', () => {
  it('releases the exact acquired path even if setup changes the data directory', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'convosketchpad-lock-'));
    try {
      writeFileSync(join(cwd, '.env'), 'CONVOSKETCHPAD_DATA_DIR=.state-before\n');
      const lockPath = acquireLock(cwd);
      expect(existsSync(lockPath)).toBe(true);

      writeFileSync(join(cwd, '.env'), 'CONVOSKETCHPAD_DATA_DIR=.state-after\n');
      releaseLock(lockPath);
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
