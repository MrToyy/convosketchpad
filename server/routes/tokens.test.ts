import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayRpcCall = vi.fn();
const supported = new Set<string>();

vi.mock('../lib/gateway-rpc.js', () => ({
  gatewayRpcCall,
  gatewaySupports: (method: string) => supported.has(method),
}));
vi.mock('../middleware/rate-limit.js', () => ({
  rateLimitGeneral: async (_c: unknown, next: () => Promise<void>) => next(),
}));

describe('GET /api/tokens', () => {
  beforeEach(() => {
    gatewayRpcCall.mockReset();
    supported.clear();
  });

  it('returns core totals immediately and adds cached optional breakdown details', async () => {
    supported.add('usage.cost');
    supported.add('sessions.usage');
    gatewayRpcCall.mockImplementation((method: string) => {
      if (method === 'usage.cost') return Promise.resolve({
        updatedAt: 123,
        totals: { input: 10, output: 20, cacheRead: 3, totalCost: 1.25 },
      });
      return Promise.resolve({
        aggregates: {
          messages: { total: 7, errors: 2 },
          byProvider: [{
            provider: 'anthropic',
            count: 7,
            totals: { input: 10, output: 20, cacheRead: 3, totalCost: 1.25 },
          }],
        },
      });
    });
    const module = await import('./tokens.js');
    module._internals.resetBreakdownCache();
    const firstResponse = await module.default.request('/api/tokens');

    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toEqual(expect.objectContaining({
      totalCost: 1.25,
      entries: [],
      breakdownAvailable: false,
    }));

    await module._internals.getBreakdownRefresh();
    const response = await module.default.request('/api/tokens');
    expect(await response.json()).toEqual({
      totalCost: 1.25,
      totalInput: 10,
      totalOutput: 20,
      totalCacheRead: 3,
      totalMessages: 7,
      totalErrors: 2,
      entries: [{
        source: 'anthropic',
        cost: 1.25,
        messageCount: 7,
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 3,
      }],
      breakdownAvailable: true,
      updatedAt: 123,
      source: 'openclaw-gateway',
    });
  });

  it('returns core totals when sessions.usage is unavailable', async () => {
    supported.add('usage.cost');
    gatewayRpcCall.mockResolvedValue({ updatedAt: 123, totals: { input: 10, output: 20 } });
    const module = await import('./tokens.js');
    module._internals.resetBreakdownCache();
    const response = await module.default.request('/api/tokens');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      totalInput: 10,
      totalOutput: 20,
      entries: [],
      breakdownAvailable: false,
    }));
    expect(gatewayRpcCall).toHaveBeenCalledTimes(1);
  });

  it('keeps returning core totals when the optional breakdown refresh fails', async () => {
    supported.add('usage.cost');
    supported.add('sessions.usage');
    gatewayRpcCall.mockImplementation((method: string) => method === 'usage.cost'
      ? Promise.resolve({ totals: { input: 10 } })
      : Promise.reject(new Error('sessions usage timed out')));
    const module = await import('./tokens.js');
    module._internals.resetBreakdownCache();
    const response = await module.default.request('/api/tokens');
    await module._internals.getBreakdownRefresh();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      totalInput: 10,
      breakdownAvailable: false,
    }));
  });
});
