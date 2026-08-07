import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  restoreSnapshotDatabase: vi.fn(),
  restoreSnapshotEnvironment: vi.fn(),
  gitCheckoutLocal: vi.fn(),
  buildProject: vi.fn(),
  existsSync: vi.fn(() => false),
  rmSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: mocks.existsSync,
  rmSync: mocks.rmSync,
}));
vi.mock('./snapshot.js', () => ({
  loadSnapshot: mocks.loadSnapshot,
  restoreSnapshotDatabase: mocks.restoreSnapshotDatabase,
  restoreSnapshotEnvironment: mocks.restoreSnapshotEnvironment,
}));
vi.mock('./installer.js', () => ({
  gitCheckoutLocal: mocks.gitCheckoutLocal,
  buildProject: mocks.buildProject,
}));

import { rollback } from './rollback.js';
import type { Reporter } from './types.js';

function reporter(): Reporter {
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

describe('updater rollback', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.existsSync.mockReturnValue(false);
    mocks.loadSnapshot.mockReturnValue({
      ref: '0123456789abcdef',
      version: '0.3.2',
      timestamp: 1,
      envHash: '',
      databaseExisted: true,
      databaseBackupPath: '/snapshot/canvas.sqlite',
    });
  });

  it('does not restore SQLite when the failed update kept the service online', async () => {
    const result = await rollback('/project', null, reporter());

    expect(result.success).toBe(true);
    expect(mocks.restoreSnapshotDatabase).not.toHaveBeenCalled();
    expect(mocks.restoreSnapshotEnvironment).toHaveBeenCalledOnce();
    expect(mocks.gitCheckoutLocal).toHaveBeenCalledWith('/project', '0123456789abcdef');
    expect(mocks.buildProject).toHaveBeenCalledWith('/project');
    expect(mocks.loadSnapshot).toHaveBeenCalledWith('/project');
  });

  it('refuses to restore SQLite unless a managed service is confirmed inactive', async () => {
    const serviceManager = {
      name: 'systemd',
      detect: vi.fn(() => true),
      stop: vi.fn(async () => undefined),
      restart: vi.fn(async () => undefined),
      status: vi.fn(async () => 'unknown' as const),
      getLogs: vi.fn(async () => ''),
    };

    const result = await rollback('/project', serviceManager, reporter());

    expect(result.success).toBe(false);
    expect(mocks.restoreSnapshotDatabase).not.toHaveBeenCalled();
    expect(mocks.gitCheckoutLocal).not.toHaveBeenCalled();
  });
});
