import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ execFileSync: execFileSyncMock }));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn(() => true),
}));
vi.mock('node:os', () => ({ homedir: () => '/Users/test' }));

import { LaunchdManager } from './service-manager.js';

describe('LaunchdManager maintenance lifecycle', () => {
  let loaded = true;
  let active = true;

  beforeEach(() => {
    loaded = true;
    active = true;
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'id') return Buffer.from('501\n');
      if (command === '/usr/libexec/PlistBuddy') {
        return Buffer.from(args[1]?.includes('WorkingDirectory') ? '/project\n' : '/project/start.sh\n');
      }
      if (command !== 'launchctl') throw new Error(`Unexpected command ${command}`);
      if (args[0] === 'list') return Buffer.from('123\t0\tcom.mrtoyy.convosketchpad\n');
      if (args[0] === 'bootout') {
        if (!loaded) throw new Error('service not loaded');
        loaded = false;
        active = false;
        return Buffer.alloc(0);
      }
      if (args[0] === 'bootstrap') {
        loaded = true;
        active = false;
        return Buffer.alloc(0);
      }
      if (args[0] === 'kickstart') {
        if (!loaded) throw new Error('service not loaded');
        active = true;
        return Buffer.alloc(0);
      }
      if (args[0] === 'print') {
        if (!loaded) throw new Error('service not loaded');
        return Buffer.from(active ? 'state = running\npid = 456\n' : 'state = spawn scheduled\n');
      }
      throw new Error(`Unexpected launchctl arguments ${args.join(' ')}`);
    });
  });

  it('bootouts a KeepAlive job idempotently and bootstraps it before restart', async () => {
    const manager = new LaunchdManager();
    expect(manager.detect('/project')).toBe(true);

    await manager.stop();
    await manager.stop();
    await expect(manager.status()).resolves.toBe('inactive');
    expect(execFileSyncMock).toHaveBeenCalledWith(
      'launchctl',
      ['bootout', 'gui/501/com.mrtoyy.convosketchpad'],
      { stdio: 'pipe' },
    );
    expect(execFileSyncMock.mock.calls.filter((call) => call[1]?.[0] === 'bootout')).toHaveLength(1);

    await manager.restart();
    await expect(manager.status()).resolves.toBe('active');
    expect(execFileSyncMock).toHaveBeenCalledWith(
      'launchctl',
      ['bootstrap', 'gui/501', '/Users/test/Library/LaunchAgents/com.mrtoyy.convosketchpad.plist'],
      { stdio: 'pipe' },
    );
    expect(execFileSyncMock).toHaveBeenCalledWith(
      'launchctl',
      ['kickstart', '-k', 'gui/501/com.mrtoyy.convosketchpad'],
      { stdio: 'pipe' },
    );
  });

  it('treats an unexpected missing job as unknown', async () => {
    const manager = new LaunchdManager();
    expect(manager.detect('/project')).toBe(true);
    loaded = false;
    await expect(manager.status()).resolves.toBe('unknown');
  });
});
