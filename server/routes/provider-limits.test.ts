import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayRpcCall = vi.fn();

vi.mock('../lib/gateway-rpc.js', () => ({ gatewayRpcCall }));
vi.mock('../middleware/rate-limit.js', () => ({
  rateLimitGeneral: async (_c: unknown, next: () => Promise<void>) => next(),
}));

describe('GET /api/provider-limits', () => {
  beforeEach(() => {
    vi.resetModules();
    gatewayRpcCall.mockReset();
  });

  it('normalises the Gateway-native usage.status response', async () => {
    gatewayRpcCall.mockResolvedValue({
      providers: [{
        provider: 'openai',
        displayName: 'OpenAI',
        windows: [{ label: '168h', usedPercent: 47, resetAt: 456 }],
        plan: 'pro',
      }],
    });
    const module = await import('./provider-limits.js');
    const response = await module.default.request('/api/provider-limits');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: true,
      providers: [{
        provider: 'openai',
        displayName: 'OpenAI',
        plan: 'pro',
        windows: [{ label: '168h', usedPercent: 47, resetAt: 456 }],
      }],
    });
    expect(gatewayRpcCall).toHaveBeenCalledWith('usage.status', {}, 15_000);
  });

  it('reports unavailable without consulting local Provider software', async () => {
    gatewayRpcCall.mockRejectedValue(new Error('method unavailable'));
    const module = await import('./provider-limits.js');
    const response = await module.default.request('/api/provider-limits');

    expect(await response.json()).toEqual({ available: false, providers: [] });
  });
});
