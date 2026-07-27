import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayRpcCall = vi.fn();

vi.mock('../lib/gateway-rpc.js', () => ({
  gatewayRpcCall,
}));
vi.mock('../middleware/rate-limit.js', () => ({
  rateLimitGeneral: async (_c: unknown, next: () => Promise<void>) => next(),
}));

describe('GET /api/tokens', () => {
  beforeEach(() => {
    gatewayRpcCall.mockReset();
  });

  it('returns only Gateway-wide usage.cost totals', async () => {
    gatewayRpcCall.mockResolvedValue({
      updatedAt: 123,
      totals: {
        input: 10,
        output: 20,
        cacheRead: 3,
        totalCost: 1.25,
      },
    });
    const module = await import('./tokens.js');
    const response = await module.default.request('/api/tokens');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      totalCost: 1.25,
      totalInput: 10,
      totalOutput: 20,
      totalCacheRead: 3,
      updatedAt: 123,
      source: 'openclaw-gateway',
    });
    expect(gatewayRpcCall).toHaveBeenCalledOnce();
    expect(gatewayRpcCall).toHaveBeenCalledWith('usage.cost', {
      agentScope: 'all',
      range: 'all',
      mode: 'gateway',
    }, 60_000);
  });

  it('normalises absent or invalid totals to zero', async () => {
    gatewayRpcCall.mockResolvedValue({
      updatedAt: Number.NaN,
      totals: { input: -1, output: '20', cacheRead: null },
    });
    const module = await import('./tokens.js');
    const response = await module.default.request('/api/tokens');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      totalCost: 0,
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      source: 'openclaw-gateway',
    }));
    expect(gatewayRpcCall).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when Gateway usage is unavailable', async () => {
    gatewayRpcCall.mockRejectedValue(new Error('usage unavailable'));
    const module = await import('./tokens.js');
    const response = await module.default.request('/api/tokens');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'gateway_usage_unavailable',
      detail: 'usage unavailable',
    });
  });
});
