import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  restart: vi.fn(),
  restartSupported: true,
}));

vi.mock('../lib/agent-runtimes/registry.js', () => ({
  agentRuntimeRegistry: {
    has: (runtimeId: string) => runtimeId === 'test-runtime',
    get: () => ({
      getStatus: () => ({
        runtimeId: 'test-runtime',
        state: 'connected',
        restartSupported: mocks.restartSupported,
      }),
      restart: mocks.restart,
    }),
  },
}));

import app from './runtime-actions.js';

beforeEach(() => {
  mocks.restart.mockReset();
  mocks.restartSupported = true;
});

describe('Agent Runtime lifecycle actions', () => {
  it('delegates restart through the selected Adapter', async () => {
    mocks.restart.mockResolvedValue({ output: 'restarted' });
    const response = await app.request('/api/runtime/runtimes/test-runtime/restart', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, output: 'restarted' });
    expect(mocks.restart).toHaveBeenCalledOnce();
  });

  it('rejects unknown and unsupported Runtime targets', async () => {
    expect((await app.request('/api/runtime/runtimes/missing/restart', {
      method: 'POST',
    })).status).toBe(404);

    mocks.restartSupported = false;
    expect((await app.request('/api/runtime/runtimes/test-runtime/restart', {
      method: 'POST',
    })).status).toBe(409);
    expect(mocks.restart).not.toHaveBeenCalled();
  });

  it.each(['/api/gateway/models', '/api/gateway/session-info'])(
    'does not expose the legacy Gateway route %s',
    async (path) => {
      expect((await app.request(path)).status).toBe(404);
    },
  );
});
