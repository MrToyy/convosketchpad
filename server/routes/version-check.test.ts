/** Tests for the local-only official Release check endpoint. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReleaseLookupResult } from '../lib/release-source.js';

const TEST_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('GET /api/version/check', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function buildApp(auth: boolean, result: ReleaseLookupResult) {
    const lookupLatestRelease = vi.fn(async () => result);

    vi.doMock('../middleware/rate-limit.js', () => ({
      rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
    }));
    vi.doMock('../lib/config.js', () => ({ config: { auth } }));
    vi.doMock('../lib/release-source.js', () => ({
      compareSemver: (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }),
      lookupLatestRelease,
    }));

    const mod = await import('./version-check.js');
    const app = new Hono();
    app.route('/', mod.default);
    return { app, lookupLatestRelease };
  }

  it('returns the project directory only for an available local-mode update', async () => {
    const { app } = await buildApp(false, {
      status: 'found',
      release: { version: '9.9.9', tag: 'v9.9.9', url: null },
    });
    const res = await app.request('/api/version/check');
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      status: 'update-available',
      latest: '9.9.9',
      updateAvailable: true,
      projectDir: TEST_REPO_ROOT,
    });
  });

  it('reports no-release without exposing the project directory', async () => {
    const { app, lookupLatestRelease } = await buildApp(false, { status: 'no-release' });
    const json = await (await app.request('/api/version/check')).json() as Record<string, unknown>;
    await app.request('/api/version/check');

    expect(json).toMatchObject({
      status: 'no-release',
      latest: null,
      updateAvailable: false,
    });
    expect(json).not.toHaveProperty('projectDir');
    expect(lookupLatestRelease).toHaveBeenCalledTimes(1);
  });

  it('disables checks under managed authentication without contacting GitHub', async () => {
    const { app, lookupLatestRelease } = await buildApp(true, {
      status: 'found',
      release: { version: '9.9.9', tag: 'v9.9.9', url: null },
    });
    const json = await (await app.request('/api/version/check')).json() as Record<string, unknown>;

    expect(json).toMatchObject({
      status: 'disabled',
      latest: null,
      updateAvailable: false,
    });
    expect(json).not.toHaveProperty('projectDir');
    expect(lookupLatestRelease).not.toHaveBeenCalled();
  });
});
