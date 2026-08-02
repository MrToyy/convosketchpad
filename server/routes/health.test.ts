import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/agent-backends/registry.js', () => ({
  agentBackendRegistry: {
    list: () => [
      { getStatus: () => ({ backendId: 'openclaw', state: 'connected' }) },
      { getStatus: () => ({ backendId: 'codex', state: 'disconnected', error: 'secret detail' }) },
    ],
  },
}));

describe('GET /health', () => {
  it('reports process health and non-sensitive aggregate Backend state', async () => {
    const route = await import('./health.js');
    const response = await route.default.request('/health');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: 'ok',
      uptime: expect.any(Number),
      agentBackends: {
        overallState: 'degraded',
        backends: [
          { backendId: 'openclaw', state: 'connected' },
          { backendId: 'codex', state: 'disconnected' },
        ],
      },
    });
    expect(JSON.stringify(payload)).not.toContain('secret detail');
  });
});
