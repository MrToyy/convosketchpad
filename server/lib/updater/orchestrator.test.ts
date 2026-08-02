import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  runPreflight: vi.fn(),
  resolveVersion: vi.fn(),
  createSnapshot: vi.fn(),
  gitFetchAndCheckout: vi.fn(),
  buildProject: vi.fn(),
  migrateDatabase: vi.fn(),
  detectServiceManager: vi.fn(),
  checkHealth: vi.fn(),
  rollback: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: mocks.writeFileSync,
    mkdirSync: mocks.mkdirSync,
  };
});
vi.mock('./lock.js', () => ({
  acquireLock: mocks.acquireLock,
  releaseLock: mocks.releaseLock,
}));
vi.mock('./preflight.js', () => ({ runPreflight: mocks.runPreflight }));
vi.mock('./release-resolver.js', () => ({ resolveVersion: mocks.resolveVersion }));
vi.mock('./snapshot.js', () => ({ createSnapshot: mocks.createSnapshot }));
vi.mock('./installer.js', () => ({
  gitFetchAndCheckout: mocks.gitFetchAndCheckout,
  buildProject: mocks.buildProject,
  migrateDatabase: mocks.migrateDatabase,
}));
vi.mock('./service-manager.js', () => ({ detectServiceManager: mocks.detectServiceManager }));
vi.mock('./health.js', () => ({
  checkHealth: mocks.checkHealth,
  resolveHealthCheckBaseUrl: vi.fn(() => 'http://127.0.0.1:3080'),
}));
vi.mock('./rollback.js', () => ({ rollback: mocks.rollback }));

import { orchestrate } from './orchestrator.js';
import { EXIT_CODES, UpdateError } from './types.js';
import type { Reporter, ServiceManager, UpdateOptions } from './types.js';

function makeReporter(): Reporter {
  return {
    stage: vi.fn(),
    ok: vi.fn(),
    warn: vi.fn(),
    fail: vi.fn(),
    info: vi.fn(),
    dry: vi.fn(),
    verbose: vi.fn(),
    hint: vi.fn(),
    cmd: vi.fn(),
    confirm: vi.fn(async () => true),
    done: vi.fn(),
    summary: vi.fn(),
  };
}

function makeOptions(): UpdateOptions {
  return {
    cwd: '/project',
    yes: true,
    dryRun: false,
    verbose: false,
    rollback: false,
    noRestart: false,
  };
}

function makeServiceManager(): ServiceManager {
  return {
    name: 'systemd',
    detect: vi.fn(() => true),
    stop: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    isActive: vi.fn(async () => true),
    getLogs: vi.fn(async () => ''),
  };
}

describe('updater orchestration around database migration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.runPreflight.mockReturnValue({
      gitVersion: '2.50.0',
      nodeVersion: '22.13.0',
      npmVersion: '10.0.0',
      isGitRepo: true,
      hasWritePermission: true,
      isClean: true,
    });
    mocks.resolveVersion.mockResolvedValue({
      tag: 'v0.4.0',
      version: '0.4.0',
      current: '0.3.2',
      isUpToDate: false,
      source: 'release',
    });
    mocks.createSnapshot.mockReturnValue({
      ref: '0123456789abcdef',
      version: '0.3.2',
      timestamp: 1,
      envHash: '',
      databaseExisted: true,
      databaseBackupPath: '/snapshot/canvas.sqlite',
    });
    mocks.checkHealth.mockResolvedValue({
      healthy: true,
      versionMatch: true,
      reportedVersion: '0.4.0',
    });
    mocks.rollback.mockResolvedValue({ success: true, snapshot: { version: '0.3.2' } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('upgrades v0.3.2 through the target migration before restart and version health check', async () => {
    vi.useFakeTimers();
    const serviceManager = makeServiceManager();
    mocks.detectServiceManager.mockReturnValue(serviceManager);

    const update = orchestrate(makeOptions(), makeReporter());
    await vi.runAllTimersAsync();
    const result = await update;

    expect(result).toBe(EXIT_CODES.SUCCESS);
    expect(mocks.gitFetchAndCheckout).toHaveBeenCalledWith('/project', 'v0.4.0');
    expect(mocks.migrateDatabase).toHaveBeenCalledWith('/project');
    expect(mocks.checkHealth).toHaveBeenCalledWith('/project', '0.4.0');
    expect(mocks.createSnapshot.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.gitFetchAndCheckout.mock.invocationCallOrder[0]);
    expect(mocks.gitFetchAndCheckout.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.migrateDatabase.mock.invocationCallOrder[0]);
    expect(mocks.migrateDatabase.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(serviceManager.restart).mock.invocationCallOrder[0]);
    expect(vi.mocked(serviceManager.restart).mock.invocationCallOrder[0])
      .toBeLessThan(mocks.checkHealth.mock.invocationCallOrder[0]);
    expect(mocks.rollback).not.toHaveBeenCalled();
  });

  it('restores the v0.3.2 snapshot when the v0.4.0 migration fails', async () => {
    const serviceManager = makeServiceManager();
    mocks.detectServiceManager.mockReturnValue(serviceManager);
    mocks.migrateDatabase.mockImplementation(() => {
      throw new UpdateError('migration failed', 'migrate', EXIT_CODES.MIGRATION);
    });

    const result = await orchestrate(makeOptions(), makeReporter());

    expect(result).toBe(EXIT_CODES.MIGRATION);
    expect(mocks.rollback).toHaveBeenCalledWith('/project', serviceManager, expect.any(Object));
    expect(serviceManager.restart).not.toHaveBeenCalled();
    expect(mocks.checkHealth).not.toHaveBeenCalled();
  });

  it('stops a managed service before taking the database snapshot', async () => {
    const serviceManager = makeServiceManager();
    mocks.detectServiceManager.mockReturnValue(serviceManager);
    mocks.buildProject.mockImplementation(() => {
      throw new UpdateError('build failed', 'build', EXIT_CODES.BUILD);
    });

    const result = await orchestrate(makeOptions(), makeReporter());

    expect(result).toBe(EXIT_CODES.BUILD);
    expect(serviceManager.stop).toHaveBeenCalledOnce();
    expect(vi.mocked(serviceManager.stop).mock.invocationCallOrder[0])
      .toBeLessThan(mocks.createSnapshot.mock.invocationCallOrder[0]);
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });

  it('restarts the old service if creating its database snapshot fails', async () => {
    const serviceManager = makeServiceManager();
    mocks.detectServiceManager.mockReturnValue(serviceManager);
    mocks.createSnapshot.mockImplementation(() => {
      throw new Error('disk full');
    });

    const result = await orchestrate(makeOptions(), makeReporter());

    expect(result).toBe(EXIT_CODES.BUILD);
    expect(serviceManager.stop).toHaveBeenCalledOnce();
    expect(serviceManager.restart).toHaveBeenCalledOnce();
    expect(mocks.gitFetchAndCheckout).not.toHaveBeenCalled();
    expect(mocks.rollback).not.toHaveBeenCalled();
  });

  it('defers migration when no managed service can be stopped', async () => {
    const reporter = makeReporter();
    mocks.detectServiceManager.mockReturnValue(null);

    const result = await orchestrate(makeOptions(), reporter);

    expect(result).toBe(EXIT_CODES.SUCCESS);
    expect(mocks.migrateDatabase).not.toHaveBeenCalled();
    expect(reporter.warn).toHaveBeenCalledWith(
      'No managed service detected — deferring database migration',
    );
  });
});
