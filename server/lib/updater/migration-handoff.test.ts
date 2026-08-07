import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireLock, releaseLock } from './lock.js';
import { resolveMigrationMaintenanceHandoff } from './migration-handoff.js';
import { resolveUpdaterStatePaths } from './state-paths.js';

function createProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'convosketchpad-handoff-'));
  writeFileSync(join(cwd, '.env'), 'CONVOSKETCHPAD_DATA_DIR=.state\n');
  return cwd;
}

describe('migration maintenance handoff', () => {
  it('accepts the current nonce lease only from its direct parent', () => {
    const cwd = createProject();
    try {
      const lease = acquireLock(cwd);
      expect(resolveMigrationMaintenanceHandoff(cwd, {
        CONVOSKETCHPAD_MAINTENANCE_LEASE: lease.token,
        CONVOSKETCHPAD_MAINTENANCE_LEASE_PATH: lease.path,
        CONVOSKETCHPAD_DATABASE_OFFLINE_LEASE: lease.token,
      }, process.pid)).toMatchObject({
        protocol: 'current',
        inherited: true,
        databaseOffline: true,
        lease: { token: lease.token },
      });
      releaseLock(lease);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('bridges the exact PID-only lock and flags emitted by the v0.4.1 updater', () => {
    const cwd = createProject();
    try {
      const { stateDir, lockPath } = resolveUpdaterStatePaths(cwd);
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(lockPath, String(process.pid), { mode: 0o600 });

      expect(resolveMigrationMaintenanceHandoff(cwd, {
        CONVOSKETCHPAD_MAINTENANCE_LOCK_HELD: '1',
        CONVOSKETCHPAD_DATABASE_OFFLINE: '1',
      }, process.pid)).toEqual({
        protocol: 'v0.4.1',
        inherited: true,
        databaseOffline: true,
        lease: null,
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('accepts the v0.4.1 handoff across the real parent-child process boundary', () => {
    const cwd = createProject();
    try {
      const { stateDir, lockPath } = resolveUpdaterStatePaths(cwd);
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(lockPath, String(process.pid), { mode: 0o600 });
      const source = [
        "import { resolveMigrationMaintenanceHandoff } from './server/lib/updater/migration-handoff.ts';",
        'const result = resolveMigrationMaintenanceHandoff(process.env.TEST_PROJECT_ROOT);',
        'process.stdout.write(JSON.stringify(result));',
      ].join('\n');

      const output = execFileSync(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '--eval', source],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            TEST_PROJECT_ROOT: cwd,
            CONVOSKETCHPAD_MAINTENANCE_LEASE: '',
            CONVOSKETCHPAD_MAINTENANCE_LEASE_PATH: '',
            CONVOSKETCHPAD_DATABASE_OFFLINE_LEASE: '',
            CONVOSKETCHPAD_MAINTENANCE_LOCK_HELD: '1',
            CONVOSKETCHPAD_DATABASE_OFFLINE: '1',
          },
          stdio: 'pipe',
        },
      ).toString();

      expect(JSON.parse(output)).toEqual({
        protocol: 'v0.4.1',
        inherited: true,
        databaseOffline: true,
        lease: null,
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects a legacy handoff when the lock is not owned by the direct parent', () => {
    const cwd = createProject();
    try {
      const { stateDir, lockPath } = resolveUpdaterStatePaths(cwd);
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(lockPath, String(process.pid), { mode: 0o600 });

      expect(() => resolveMigrationMaintenanceHandoff(cwd, {
        CONVOSKETCHPAD_MAINTENANCE_LOCK_HELD: '1',
        CONVOSKETCHPAD_DATABASE_OFFLINE: '1',
      }, process.pid + 1)).toThrow(/Legacy v0\.4\.1 maintenance handoff is invalid/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('does not let legacy flags downgrade or bypass a current JSON lease', () => {
    const cwd = createProject();
    try {
      const lease = acquireLock(cwd);
      expect(() => resolveMigrationMaintenanceHandoff(cwd, {
        CONVOSKETCHPAD_MAINTENANCE_LOCK_HELD: '1',
        CONVOSKETCHPAD_DATABASE_OFFLINE: '1',
      }, process.pid)).toThrow(/Legacy v0\.4\.1 maintenance handoff is invalid/);
      releaseLock(lease);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('never trusts an offline boolean without a validated maintenance handoff', () => {
    const cwd = createProject();
    try {
      expect(resolveMigrationMaintenanceHandoff(cwd, {
        CONVOSKETCHPAD_DATABASE_OFFLINE: '1',
      }, process.pid)).toEqual({
        protocol: null,
        inherited: false,
        databaseOffline: false,
        lease: null,
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
