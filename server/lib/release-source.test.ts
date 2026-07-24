import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isOfficialOriginUrl,
  lookupLatestRelease,
  lookupReleaseByVersion,
} from './release-source.js';

describe('official release source', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn<typeof fetch>();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('accepts only the official HTTPS origin', () => {
    expect(isOfficialOriginUrl('https://github.com/MrToyy/convosketchpad.git')).toBe(true);
    expect(isOfficialOriginUrl('https://github.com/mrtoyy/convosketchpad')).toBe(true);
    expect(isOfficialOriginUrl('git@github.com:MrToyy/convosketchpad.git')).toBe(false);
    expect(isOfficialOriginUrl('https://github.com/example/convosketchpad.git')).toBe(false);
  });

  it('resolves a stable release from the fixed official repository', async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({
      tag_name: 'v0.2.0',
      html_url: 'https://github.com/MrToyy/convosketchpad/releases/tag/v0.2.0',
      draft: false,
      prerelease: false,
    }), { status: 200 }));

    await expect(lookupLatestRelease()).resolves.toEqual({
      status: 'found',
      release: {
        version: '0.2.0',
        tag: 'v0.2.0',
        url: 'https://github.com/MrToyy/convosketchpad/releases/tag/v0.2.0',
      },
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/MrToyy/convosketchpad/releases/latest',
      expect.any(Object),
    );
  });

  it('treats a missing release as no-release without consulting git tags', async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response('{}', { status: 404 }));
    await expect(lookupLatestRelease()).resolves.toEqual({ status: 'no-release' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects prereleases and malformed stable tags', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tag_name: 'v0.2.0',
        draft: false,
        prerelease: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tag_name: '0.2.0',
        draft: false,
        prerelease: false,
      }), { status: 200 }));

    await expect(lookupLatestRelease()).resolves.toEqual({ status: 'no-release' });
    await expect(lookupLatestRelease()).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('looks up explicit versions through the official Release-by-tag endpoint', async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({
      tag_name: 'v0.3.0',
      draft: false,
      prerelease: false,
    }), { status: 200 }));

    await expect(lookupReleaseByVersion('0.3.0')).resolves.toMatchObject({
      status: 'found',
      release: { version: '0.3.0' },
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/MrToyy/convosketchpad/releases/tags/v0.3.0',
      expect.any(Object),
    );
  });

  it('reports transient GitHub failures as unavailable', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('offline'));
    await expect(lookupLatestRelease()).resolves.toEqual({
      status: 'unavailable',
      error: 'offline',
    });
  });
});
