/** GET /api/version/check — resolve official ConvoSketchpad updates. */

import { Hono } from 'hono';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { config } from '../lib/config.js';
import {
  compareSemver,
  lookupLatestRelease,
  type ReleaseLookupResult,
} from '../lib/release-source.js';
import { packageMetadata } from '../lib/package-metadata.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type VersionCheckStatus =
  | 'disabled'
  | 'up-to-date'
  | 'update-available'
  | 'no-release'
  | 'unavailable';

interface VersionCache {
  result: ReleaseLookupResult;
  checkedAt: number;
}

const FOUND_CACHE_TTL_MS = 60 * 60 * 1000;
const NO_RELEASE_CACHE_TTL_MS = 5 * 60 * 1000;
const ERROR_CACHE_TTL_MS = 60 * 1000;
let cache: VersionCache | null = null;
const projectDir = resolve(__dirname, '../..');

const app = new Hono();

function cacheTtl(result: ReleaseLookupResult): number {
  if (result.status === 'found') return FOUND_CACHE_TTL_MS;
  if (result.status === 'no-release') return NO_RELEASE_CACHE_TTL_MS;
  return ERROR_CACHE_TTL_MS;
}

function responseFor(result: ReleaseLookupResult) {
  if (result.status === 'no-release') {
    return {
      status: 'no-release' as const,
      current: packageMetadata.version,
      latest: null,
      source: null,
      updateAvailable: false,
    };
  }

  if (result.status === 'unavailable') {
    return {
      status: 'unavailable' as const,
      current: packageMetadata.version,
      latest: null,
      source: null,
      updateAvailable: false,
      error: result.error,
    };
  }

  const updateAvailable = compareSemver(result.release.version, packageMetadata.version) > 0;
  return {
    status: updateAvailable ? 'update-available' as const : 'up-to-date' as const,
    current: packageMetadata.version,
    latest: result.release.version,
    source: 'release' as const,
    updateAvailable,
    ...(updateAvailable ? { projectDir } : {}),
  };
}

app.get('/api/version/check', rateLimitGeneral, async (c) => {
  // Managed users are not host administrators. Keep update paths and release
  // checks confined to local-mode installations.
  if (config.auth) {
    return c.json({
      status: 'disabled' as const,
      current: packageMetadata.version,
      latest: null,
      source: null,
      updateAvailable: false,
    });
  }

  const now = Date.now();
  if (cache && now - cache.checkedAt < cacheTtl(cache.result)) {
    return c.json(responseFor(cache.result));
  }

  const result = await lookupLatestRelease();
  cache = { result, checkedAt: now };
  return c.json(responseFor(result));
});

export default app;
