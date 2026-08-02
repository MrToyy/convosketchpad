import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.fn();
vi.mock('../lib/agent-backends/registry.js', () => ({
  agentBackendRegistry: { list },
}));
vi.mock('../middleware/rate-limit.js', () => ({
  rateLimitGeneral: async (_c: unknown, next: () => Promise<void>) => next(),
}));

const capabilities = {
  usage: { accountUsage: true, accountQuota: true },
};

function backend(id: string, cost: number, currency = 'USD') {
  return {
    id,
    describe: vi.fn(async () => ({ id, displayName: id.toUpperCase() })),
    getStatus: vi.fn(() => ({ backendId: id, state: 'connected', capabilities })),
    getCapabilities: vi.fn(async () => capabilities),
    readUsageSummary: vi.fn(async () => ({
      totalCost: cost,
      totalInput: 10,
      totalOutput: 20,
      totalCacheRead: 3,
      updatedAt: 123,
      source: id,
      currency,
      period: 'all-time',
      additive: true,
    })),
    readProviderQuotas: vi.fn(async () => ({ available: true, providers: [] })),
  };
}

describe('GET /api/runtime/usage', () => {
  beforeEach(() => list.mockReset());

  it('returns per-Backend usage and sums only comparable costs', async () => {
    list.mockReturnValue([backend('openclaw', 1.25), backend('codex', 2)]);
    const route = await import('./tokens.js');
    const response = await route.default.request('/api/runtime/usage');
    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, unknown>;
    expect(json).toMatchObject({
      comparableCostTotal: { currency: 'USD', amount: 3.25 },
      backends: [
        { backendId: 'openclaw', available: true },
        { backendId: 'codex', available: true },
      ],
    });
  });

  it('omits a global total for incomparable currencies', async () => {
    list.mockReturnValue([backend('openclaw', 1.25), backend('codex', 2, 'CNY')]);
    const route = await import('./tokens.js');
    const json = await (await route.default.request('/api/runtime/usage')).json() as Record<string, unknown>;
    expect(json).not.toHaveProperty('comparableCostTotal');
  });

  it('keeps partial data when one Backend is unavailable', async () => {
    const unavailable = backend('codex', 0);
    unavailable.getStatus.mockReturnValue({ backendId: 'codex', state: 'disconnected', capabilities } as never);
    list.mockReturnValue([backend('openclaw', 1.25), unavailable]);
    const route = await import('./tokens.js');
    const json = await (await route.default.request('/api/runtime/usage')).json() as { backends: Array<Record<string, unknown>> };
    expect(json.backends[0]).toMatchObject({ backendId: 'openclaw', available: true });
    expect(json.backends[1]).toMatchObject({ backendId: 'codex', available: false });
    expect(json).not.toHaveProperty('comparableCostTotal');
  });

  it('does not treat a connected Backend without account usage as unavailable', async () => {
    const noUsage = backend('local-tools', 0);
    const noUsageCapabilities = { usage: { accountUsage: false, accountQuota: false } };
    noUsage.getStatus.mockReturnValue({
      backendId: 'local-tools',
      state: 'connected',
      capabilities: noUsageCapabilities,
    } as never);
    noUsage.getCapabilities.mockResolvedValue(noUsageCapabilities as never);
    list.mockReturnValue([backend('openclaw', 1.25), noUsage]);
    const route = await import('./tokens.js');
    const json = await (await route.default.request('/api/runtime/usage')).json() as {
      comparableCostTotal?: unknown;
      backends: Array<Record<string, unknown>>;
    };
    expect(json.backends[1]).toMatchObject({
      backendId: 'local-tools',
      available: true,
      usageSupported: false,
    });
    expect(json.comparableCostTotal).toBeDefined();
    expect(noUsage.readUsageSummary).not.toHaveBeenCalled();
  });
});
