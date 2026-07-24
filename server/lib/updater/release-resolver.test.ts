import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CODES, UpdateError } from './types.js';

const releaseMocks = vi.hoisted(() => ({
  lookupLatestRelease: vi.fn(),
  lookupReleaseByVersion: vi.fn(),
}));

vi.mock('../release-source.js', () => ({
  compareSemver: (a: string, b: string) => {
    const left = a.split('.').map(Number);
    const right = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return 0;
  },
  normalizeSemverTag: (tag: string) => {
    const match = /^v?(\d+\.\d+\.\d+)$/.exec(tag);
    return match?.[1] ?? null;
  },
  ...releaseMocks,
}));

import { resolveVersion } from './release-resolver.js';

describe('release resolver', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'convosketchpad-release-resolver-'));
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({
      name: 'convosketchpad',
      version: '0.1.0',
    }));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('resolves the latest official stable release', async () => {
    releaseMocks.lookupLatestRelease.mockResolvedValue({
      status: 'found',
      release: { version: '0.2.0', tag: 'v0.2.0', url: null },
    });

    await expect(resolveVersion(cwd)).resolves.toEqual({
      tag: 'v0.2.0',
      version: '0.2.0',
      current: '0.1.0',
      isUpToDate: false,
      source: 'release',
    });
  });

  it('requires an explicit version to be an official Release', async () => {
    releaseMocks.lookupReleaseByVersion.mockResolvedValue({ status: 'no-release' });

    await expect(resolveVersion(cwd, 'v1.5.3')).rejects.toMatchObject({
      name: 'UpdateError',
      exitCode: EXIT_CODES.VERSION_RESOLUTION,
    });
    expect(releaseMocks.lookupReleaseByVersion).toHaveBeenCalledWith('1.5.3');
  });

  it('treats the same version as already up to date', async () => {
    releaseMocks.lookupLatestRelease.mockResolvedValue({
      status: 'found',
      release: { version: '0.1.0', tag: 'v0.1.0', url: null },
    });

    await expect(resolveVersion(cwd)).resolves.toMatchObject({ isUpToDate: true });
  });

  it('refuses a downgrade even when an older Release exists', async () => {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({
      name: 'convosketchpad',
      version: '0.3.0',
    }));
    releaseMocks.lookupReleaseByVersion.mockResolvedValue({
      status: 'found',
      release: { version: '0.2.0', tag: 'v0.2.0', url: null },
    });

    await expect(resolveVersion(cwd, 'v0.2.0')).rejects.toBeInstanceOf(UpdateError);
  });
});
