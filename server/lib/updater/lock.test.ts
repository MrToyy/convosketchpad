import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireLock, releaseLock, validateInheritedLease } from './lock.js';

describe('maintenance lock', () => {
  it('releases the exact acquired path even if setup changes the data directory', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'convosketchpad-lock-'));
    try {
      writeFileSync(join(cwd, '.env'), 'CONVOSKETCHPAD_DATA_DIR=.state-before\n');
      const lease = acquireLock(cwd);
      expect(existsSync(lease.path)).toBe(true);

      writeFileSync(join(cwd, '.env'), 'CONVOSKETCHPAD_DATA_DIR=.state-after\n');
      expect(validateInheritedLease(cwd, lease.token, process.pid, lease.path).path)
        .toBe(lease.path);
      releaseLock(lease);
      expect(existsSync(lease.path)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('accepts only the nonce owned by the expected live parent', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'convosketchpad-lease-'));
    try {
      writeFileSync(join(cwd, '.env'), 'CONVOSKETCHPAD_DATA_DIR=.state\n');
      const lease = acquireLock(cwd);
      expect(validateInheritedLease(cwd, lease.token, process.pid)).toMatchObject({
        token: lease.token,
        pid: process.pid,
      });
      expect(() => validateInheritedLease(cwd, 'wrong-token', process.pid))
        .toThrow(/invalid or no longer owned/);
      expect(() => validateInheritedLease(cwd, lease.token, process.pid + 1))
        .toThrow(/invalid or no longer owned/);
      releaseLock(lease);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
