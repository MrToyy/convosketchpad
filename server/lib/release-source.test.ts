import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isOfficialOriginUrl,
  lookupLatestRelease,
  lookupReleaseByVersion,
} from './release-source.js';

describe('official release source', () => {
  const originalFetch = global.fetch;
  const originalGithubToken = process.env.GITHUB_TOKEN;
  const originalGhToken = process.env.GH_TOKEN;

  beforeEach(() => {
    global.fetch = vi.fn<typeof fetch>();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalGithubToken;
    if (originalGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = originalGhToken;
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

  it('diagnoses the primary API rate limit and reports its reset time', async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response('', {
      status: 403,
      headers: {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1786089600',
      },
    }));

    await expect(lookupLatestRelease()).resolves.toEqual({
      status: 'unavailable',
      error: 'GitHub API rate limit exceeded. The limit resets at 2026-08-07T08:00:00.000Z. Set GITHUB_TOKEN or GH_TOKEN to increase the request limit.',
    });
  });

  it('diagnoses a temporary secondary rate limit without returning the response body', async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response('sensitive diagnostic body', {
      status: 403,
      headers: { 'retry-after': '60' },
    }));

    await expect(lookupLatestRelease()).resolves.toEqual({
      status: 'unavailable',
      error: 'GitHub temporarily rejected the release request; retry after 60 seconds.',
    });
  });

  it('diagnoses a rejected configured token without exposing it', async () => {
    process.env.GITHUB_TOKEN = 'top-secret-token';
    vi.mocked(global.fetch).mockResolvedValue(new Response('bad credentials', { status: 401 }));

    const result = await lookupLatestRelease();
    expect(result).toEqual({
      status: 'unavailable',
      error: 'GitHub rejected GITHUB_TOKEN or GH_TOKEN; refresh the token or unset it to use unauthenticated requests.',
    });
    expect(JSON.stringify(result)).not.toContain('top-secret-token');
    expect(JSON.stringify(result)).not.toContain('bad credentials');
  });
});
