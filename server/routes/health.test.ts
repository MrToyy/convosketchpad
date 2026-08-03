import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/agent-runtimes/registry.js', () => ({
  agentRuntimeRegistry: {
    list: () => [
      { getStatus: () => ({ runtimeId: 'openclaw', state: 'connected' }) },
      { getStatus: () => ({ runtimeId: 'codex', state: 'disconnected', error: 'secret detail' }) },
    ],
  },
}));

describe('GET /health', () => {
  it('reports process health and non-sensitive aggregate Runtime state', async () => {
    const route = await import('./health.js');
    const response = await route.default.request('/health');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: 'ok',
      uptime: expect.any(Number),
      agentRuntimes: {
        overallState: 'degraded',
        runtimes: [
          { runtimeId: 'openclaw', state: 'connected' },
          { runtimeId: 'codex', state: 'disconnected' },
        ],
      },
    });
    expect(JSON.stringify(payload)).not.toContain('secret detail');
  });
});
