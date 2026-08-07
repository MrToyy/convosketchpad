import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSnapshot: vi.fn(),
  restoreSnapshotDatabase: vi.fn(),
  discardSnapshot: vi.fn(),
  detectServiceManager: vi.fn(),
  execFileSync: vi.fn(),
  checkHealth: vi.fn(),
  readFileSync: vi.fn(() => '{"version":"0.4.0"}'),
}));

vi.mock('node:child_process', () => ({ execFileSync: mocks.execFileSync }));
vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(),
  readFileSync: mocks.readFileSync,
}));
vi.mock('../../server/lib/updater/snapshot.js', () => ({
  createSnapshot: mocks.createSnapshot,
  restoreSnapshotDatabase: mocks.restoreSnapshotDatabase,
  discardSnapshot: mocks.discardSnapshot,
}));
vi.mock('../../server/lib/updater/service-manager.js', () => ({
  detectServiceManager: mocks.detectServiceManager,
  waitForServiceState: vi.fn(async (manager: { status(): Promise<ServiceState> }) => manager.status()),
}));
vi.mock('../../server/lib/updater/health.js', () => ({ checkHealth: mocks.checkHealth }));

import { migrateDatabaseAfterSetup } from './setup-database-migration.js';
import type { ServiceState } from '../../server/lib/updater/types.js';

const lease = {
  schemaVersion: 1 as const,
  path: '/state/update.lock',
  token: 'lease-token',
  pid: 1,
  startedAt: 1,
  cwd: '/project',
};

function reporter() {
  return { info: vi.fn(), success: vi.fn(), warn: vi.fn() };
}

function service(active: boolean) {
  let state: ServiceState = active ? 'active' : 'inactive';
  return {
    name: 'systemd',
    detect: vi.fn(() => true),
    status: vi.fn(async () => state),
    stop: vi.fn(async () => { state = 'inactive'; }),
    restart: vi.fn(async () => { state = 'active'; }),
    getLogs: vi.fn(async () => ''),
  };
}

describe('setup database migration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createSnapshot.mockReturnValue({ ref: 'abc', version: '0.4.0' });
    mocks.checkHealth.mockResolvedValue({ healthy: true, versionMatch: true, reportedVersion: '0.4.0' });
    mocks.readFileSync.mockReturnValue('{"version":"0.4.0"}');
  });

  it('restarts a service that was active after a successful migration', async () => {
    const manager = service(true);
    mocks.detectServiceManager.mockReturnValue(manager);

    await migrateDatabaseAfterSetup('/project', reporter(), lease);

    expect(manager.stop).toHaveBeenCalledOnce();
    expect(manager.restart).toHaveBeenCalledOnce();
    expect(mocks.restoreSnapshotDatabase).not.toHaveBeenCalled();
    expect(mocks.createSnapshot).toHaveBeenCalledWith('/project', {
      includeCodeMetadata: false,
      includeEnvironment: false,
      recordLastGood: false,
    });
    expect(mocks.discardSnapshot).toHaveBeenCalledOnce();
    expect(mocks.checkHealth).toHaveBeenCalledWith('/project', '0.4.0');
  });

  it('leaves an inactive service inactive', async () => {
    const manager = service(false);
    mocks.detectServiceManager.mockReturnValue(manager);

    await migrateDatabaseAfterSetup('/project', reporter(), lease);

    expect(manager.stop).not.toHaveBeenCalled();
    expect(manager.restart).not.toHaveBeenCalled();
  });

  it('defers migration when no matching managed service exists', async () => {
    const output = reporter();
    mocks.detectServiceManager.mockReturnValue(null);

    await migrateDatabaseAfterSetup('/project', output, lease);

    expect(mocks.createSnapshot).not.toHaveBeenCalled();
    expect(mocks.execFileSync).not.toHaveBeenCalled();
    expect(output.warn).toHaveBeenCalledWith(expect.stringContaining('deferring database migration'));
  });

  it('restores the database and leaves the previously active service stopped on failure', async () => {
    const manager = service(true);
    const output = reporter();
    const snapshot = { ref: 'abc', version: '0.4.0' };
    mocks.detectServiceManager.mockReturnValue(manager);
    mocks.createSnapshot.mockReturnValue(snapshot);
    mocks.execFileSync.mockImplementation(() => { throw new Error('migration failed'); });

    await expect(migrateDatabaseAfterSetup('/project', output, lease)).rejects.toThrow(
      /pre-setup database was restored/,
    );

    expect(mocks.restoreSnapshotDatabase).toHaveBeenCalledWith('/project', snapshot);
    expect(mocks.discardSnapshot).toHaveBeenCalledWith('/project', snapshot);
    expect(manager.restart).not.toHaveBeenCalled();
    expect(output.warn).toHaveBeenCalledWith(expect.stringContaining('remains stopped'));
  });

  it('restores the database when restarting the migrated service fails', async () => {
    const manager = service(true);
    const snapshot = { ref: 'abc', version: '0.4.0' };
    mocks.detectServiceManager.mockReturnValue(manager);
    mocks.createSnapshot.mockReturnValue(snapshot);
    vi.mocked(manager.restart).mockRejectedValue(new Error('permission denied'));

    await expect(migrateDatabaseAfterSetup('/project', reporter(), lease)).rejects.toThrow(
      /pre-setup database was restored/,
    );

    expect(mocks.restoreSnapshotDatabase).toHaveBeenCalledWith('/project', snapshot);
    expect(manager.stop).toHaveBeenCalledTimes(2);
  });

  it('restores the database when the restarted service fails health verification', async () => {
    const manager = service(true);
    const snapshot = { ref: 'abc', version: '0.4.0' };
    mocks.detectServiceManager.mockReturnValue(manager);
    mocks.createSnapshot.mockReturnValue(snapshot);
    mocks.checkHealth.mockResolvedValue({ healthy: false, versionMatch: false, error: 'unhealthy' });

    await expect(migrateDatabaseAfterSetup('/project', reporter(), lease)).rejects.toThrow(/pre-setup database was restored/);

    expect(manager.stop).toHaveBeenCalledTimes(2);
    expect(mocks.restoreSnapshotDatabase).toHaveBeenCalledWith('/project', snapshot);
  });

  it('retains the snapshot and does not replace SQLite when a restarted service cannot be stopped', async () => {
    const manager = service(true);
    const snapshot = { ref: 'abc', version: '0.4.0' };
    const output = reporter();
    mocks.detectServiceManager.mockReturnValue(manager);
    mocks.createSnapshot.mockReturnValue(snapshot);
    mocks.checkHealth.mockResolvedValue({ healthy: false, versionMatch: false, error: 'unhealthy' });
    vi.mocked(manager.stop)
      .mockImplementationOnce(async () => undefined)
      .mockRejectedValueOnce(new Error('permission denied'));
    vi.mocked(manager.status)
      .mockResolvedValueOnce('active')
      .mockResolvedValueOnce('inactive')
      .mockResolvedValueOnce('active');

    await expect(migrateDatabaseAfterSetup('/project', output, lease)).rejects.toThrow(/Database migration failed/);

    expect(mocks.restoreSnapshotDatabase).not.toHaveBeenCalled();
    expect(mocks.discardSnapshot).not.toHaveBeenCalled();
    expect(output.warn).toHaveBeenCalledWith(expect.stringContaining('snapshot was retained'));
  });

  it('fails closed before opening SQLite when service state is unknown', async () => {
    const manager = service(false);
    vi.mocked(manager.status).mockResolvedValue('unknown');
    mocks.detectServiceManager.mockReturnValue(manager);

    await expect(migrateDatabaseAfterSetup('/project', reporter(), lease)).rejects.toThrow(/refusing to migrate SQLite/);

    expect(mocks.createSnapshot).not.toHaveBeenCalled();
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });
});
