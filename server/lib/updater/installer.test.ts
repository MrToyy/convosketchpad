import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    default: { ...actual, execFileSync: execFileSyncMock },
    execFileSync: execFileSyncMock,
  };
});

import {
  buildProject,
  gitFetchAndCheckout,
  migrateDatabase,
  migrateEnvironment,
} from './installer.js';

const lease = {
  schemaVersion: 1 as const,
  path: '/state/update.lock',
  token: 'lease-token',
  pid: process.pid,
  startedAt: 1,
  cwd: '/project',
};

describe('updater installer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'git' && args[0] === 'show') {
        if (args[1]?.endsWith(':update-compatibility.json')) {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            packageName: 'convosketchpad',
            applicationVersion: '0.4.0',
            databaseSchemaEpoch: 3,
            minimumReadableDatabaseSchemaEpoch: 3,
            maximumReadableDatabaseSchemaEpoch: 3,
          }));
        }
        return Buffer.from(JSON.stringify({ name: 'convosketchpad', version: '0.4.0' }));
      }
      return Buffer.from('');
    });
  });

  it('fetches only the selected tag, validates it, and checks out the internal ref', () => {
    gitFetchAndCheckout('/project', 'v0.4.0');

    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      1,
      'git',
      [
        'fetch',
        '--no-tags',
        'origin',
        'refs/tags/v0.4.0:refs/convosketchpad/releases/v0.4.0',
      ],
      expect.objectContaining({ cwd: '/project' }),
    );
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      2,
      'git',
      ['show', 'refs/convosketchpad/releases/v0.4.0:package.json'],
      expect.objectContaining({ cwd: '/project' }),
    );
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      3,
      'git',
      ['show', 'refs/convosketchpad/releases/v0.4.0:update-compatibility.json'],
      expect.objectContaining({ cwd: '/project' }),
    );
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      4,
      'git',
      ['checkout', '--force', '--detach', 'refs/convosketchpad/releases/v0.4.0'],
      expect.objectContaining({ cwd: '/project' }),
    );
  });

  it('rejects an inherited Nerve package before checkout', () => {
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'git' && args[0] === 'show') {
        return Buffer.from(JSON.stringify({ name: 'openclaw-nerve', version: '1.5.3' }));
      }
      return Buffer.from('');
    });

    expect(() => gitFetchAndCheckout('/project', 'v1.5.3')).toThrow(/Release package validation failed/);
    expect(execFileSyncMock).toHaveBeenCalledTimes(2);
  });

  it('uses npm ci and runs the complete build once', () => {
    buildProject('/project');

    expect(execFileSyncMock).toHaveBeenCalledTimes(2);
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      1,
      'npm',
      ['ci'],
      expect.objectContaining({ cwd: '/project' }),
    );
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      2,
      'npm',
      ['run', 'build'],
      expect.objectContaining({ cwd: '/project' }),
    );
  });

  it('runs the migration CLI built from the selected release', () => {
    migrateDatabase('/project', lease);

    expect(execFileSyncMock).toHaveBeenCalledWith(
      process.execPath,
      ['bin-dist/bin/convosketchpad-migrate.js'],
      expect.objectContaining({
        cwd: '/project',
        env: expect.objectContaining({
          CONVOSKETCHPAD_MAINTENANCE_LEASE: 'lease-token',
          CONVOSKETCHPAD_MAINTENANCE_LEASE_PATH: '/state/update.lock',
          CONVOSKETCHPAD_DATABASE_OFFLINE_LEASE: 'lease-token',
        }),
      }),
    );
  });

  it('can migrate Runtime environment configuration without opening the database', () => {
    migrateEnvironment('/project', lease);

    expect(execFileSyncMock).toHaveBeenCalledWith(
      process.execPath,
      ['bin-dist/bin/convosketchpad-migrate.js', '--env-only'],
      expect.objectContaining({
        cwd: '/project',
        env: expect.objectContaining({
          CONVOSKETCHPAD_MAINTENANCE_LEASE: 'lease-token',
          CONVOSKETCHPAD_MAINTENANCE_LEASE_PATH: '/state/update.lock',
        }),
      }),
    );
  });
});
