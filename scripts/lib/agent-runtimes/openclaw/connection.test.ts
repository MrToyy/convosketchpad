import { afterEach, describe, expect, it, vi } from 'vitest';
import { testGatewayConnection } from './connection.js';

afterEach(() => vi.unstubAllGlobals());

describe('OpenClaw Gateway setup connection check', () => {
  it('checks reachability without sending an auth request when no token is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(testGatewayConnection('http://127.0.0.1:18789')).resolves.toEqual({
      ok: true,
      message: 'Gateway reachable',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('reports an explicitly rejected shared token', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 })));

    await expect(testGatewayConnection('https://gateway.example.test', 'bad-token'))
      .resolves.toEqual({ ok: false, message: 'Gateway auth token rejected' });
  });
});
