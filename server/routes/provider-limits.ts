/**
 * GET /api/provider-limits — Provider quota windows reported by OpenClaw.
 *
 * OpenClaw's `usage.status` RPC is the only source. This route never reads
 * Codex/Claude credentials or invokes their local CLIs.
 */

import { Hono } from 'hono';
import { createCachedFetch } from '../lib/cached-fetch.js';
import { gatewayRpcCall } from '../lib/gateway-rpc.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();

interface ProviderLimitWindow {
  label: string;
  usedPercent: number;
  resetAt: number | null;
}

interface ProviderLimit {
  provider: string;
  displayName: string;
  plan: string | null;
  windows: ProviderLimitWindow[];
}

interface ProviderLimitsResponse {
  available: boolean;
  providers: ProviderLimit[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseProviderLimits(status: unknown): ProviderLimit[] {
  const providers = record(status).providers;
  if (!Array.isArray(providers)) return [];

  return providers.flatMap((value) => {
    const provider = record(value);
    const providerId = typeof provider.provider === 'string' ? provider.provider : '';
    if (!providerId) return [];
    const windows = Array.isArray(provider.windows)
      ? provider.windows.flatMap((windowValue) => {
          const window = record(windowValue);
          if (
            typeof window.label !== 'string'
            || typeof window.usedPercent !== 'number'
            || !Number.isFinite(window.usedPercent)
          ) return [];
          return [{
            label: window.label,
            usedPercent: Math.min(100, Math.max(0, window.usedPercent)),
            resetAt: typeof window.resetAt === 'number' && Number.isFinite(window.resetAt)
              ? window.resetAt
              : null,
          }];
        })
      : [];
    return [{
      provider: providerId,
      displayName: typeof provider.displayName === 'string' ? provider.displayName : providerId,
      plan: typeof provider.plan === 'string' ? provider.plan : null,
      windows,
    }];
  });
}

async function fetchProviderLimits(): Promise<ProviderLimitsResponse> {
  try {
    const status = await gatewayRpcCall('usage.status', {}, 15_000);
    return { available: true, providers: parseProviderLimits(status) };
  } catch {
    return { available: false, providers: [] };
  }
}

const getProviderLimitsCached = createCachedFetch(fetchProviderLimits, undefined, {
  isValid: (result) => result.available,
});

app.get('/api/provider-limits', rateLimitGeneral, async (c) => {
  return c.json(await getProviderLimitsCached());
});

export const _internals = { parseProviderLimits };

export default app;
