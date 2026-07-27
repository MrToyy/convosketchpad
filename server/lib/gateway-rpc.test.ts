/** Tests for the shared gateway RPC client (persistent WebSocket). */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { WebSocketServer } from 'ws';

interface MockStoredDeviceAuth {
  deviceId: string;
  role: 'operator';
  scopes: string[];
  token: string;
  updatedAt: string;
}

// Mock config to point at our test server
let testPort: number;
vi.mock('./config.js', () => ({
  get config() {
    return {
      gatewayUrl: `http://127.0.0.1:${testPort}`,
      gatewayToken: 'test-token',
      port: 3080,
      publicOrigin: process.env.CONVOSKETCHPAD_PUBLIC_ORIGIN || '',
    };
  },
}));

const {
  clearStoredDeviceAuthMock,
  createDeviceBlockMock,
  gatewayConnectionModeMock,
  getStoredDeviceAuthMock,
  storeDeviceAuthMock,
} = vi.hoisted(() => ({
  clearStoredDeviceAuthMock: vi.fn(),
  createDeviceBlockMock: vi.fn(({ nonce, clientId, clientMode, role, scopes, token }) => ({
    id: 'device-123',
    publicKey: 'pubkey-123',
    signature: `sig-${nonce}`,
    signedAt: 1234567890,
    nonce,
    _debug: { clientId, clientMode, role, scopes, token },
  })),
  gatewayConnectionModeMock: vi.fn<() => 'loopback' | 'remote'>(() => 'loopback'),
  getStoredDeviceAuthMock: vi.fn<() => MockStoredDeviceAuth | null>(() => null),
  storeDeviceAuthMock: vi.fn(),
}));

vi.mock('./gateway-client-identity.js', () => ({
  CONVOSKETCHPAD_GATEWAY_CLIENT_ID: 'gateway-client',
  CONVOSKETCHPAD_GATEWAY_CLIENT_MODE: 'backend',
  CONVOSKETCHPAD_GATEWAY_CLIENT_PLATFORM: 'node',
  gatewayConnectionMode: gatewayConnectionModeMock,
}));

vi.mock('./device-identity.js', () => ({
  clearStoredDeviceAuth: clearStoredDeviceAuthMock,
  CONVOSKETCHPAD_OPERATOR_SCOPES: ['operator.read', 'operator.write'],
  createDeviceBlock: createDeviceBlockMock,
  getStoredDeviceAuth: getStoredDeviceAuthMock,
  storeDeviceAuth: storeDeviceAuthMock,
}));

import {
  gatewayRpcCall,
  gatewayDispatchCall,
} from './gateway-rpc.js';

let wss: WebSocketServer;

async function importFreshGatewayRpc() {
  for (const client of wss.clients) client.close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  vi.resetModules();
  return await import('./gateway-rpc.js');
}

describe('gateway-rpc (persistent WebSocket)', () => {
  /** Handler for incoming RPC method calls (after connect handshake) */
  let rpcHandler: (method: string, params: unknown) => unknown;
  let lastConnectParams: unknown = null;
  let lastRequestOrigin: string | undefined;
  let connectMode: 'accept' | 'reject' | 'close' = 'accept';
  let connectPayload: Record<string, unknown> = {};
  let closeOnRpcMethod = '';

  beforeAll(async () => {
    rpcHandler = () => ({});

    wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve, reject) => {
      wss.once('listening', resolve);
      wss.once('error', reject);
    });
    testPort = (wss.address() as { port: number }).port;

    wss.on('connection', (ws, req) => {
      lastRequestOrigin = req.headers.origin;

      // Send challenge immediately
      ws.send(JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'test-nonce', ts: Date.now() },
      }));

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.method === 'connect') {
          lastConnectParams = msg.params;
          if (connectMode === 'reject') {
            ws.send(JSON.stringify({ type: 'res', id: msg.id, ok: false, error: { message: 'connect rejected by test server' } }));
            return;
          }
          if (connectMode === 'close') {
            ws.close();
            return;
          }
          ws.send(JSON.stringify({ type: 'res', id: msg.id, ok: true, payload: connectPayload }));
          return;
        }

        // RPC call
        if (msg.method === closeOnRpcMethod) {
          ws.close();
          return;
        }
        try {
          const result = rpcHandler(msg.method, msg.params);
          ws.send(JSON.stringify({ type: 'res', id: msg.id, ok: true, payload: result }));
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'res', id: msg.id, ok: false,
            error: { message: (err as Error).message },
          }));
        }
      });
    });
  });

  afterAll(() => {
    wss.close();
  });

  beforeEach(() => {
    rpcHandler = () => ({});
    lastConnectParams = null;
    lastRequestOrigin = undefined;
    connectMode = 'accept';
    connectPayload = {};
    closeOnRpcMethod = '';
    gatewayConnectionModeMock.mockReturnValue('loopback');
    getStoredDeviceAuthMock.mockReturnValue(null);
    delete process.env.CONVOSKETCHPAD_PUBLIC_ORIGIN;
    delete process.env.ALLOWED_ORIGINS;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('gatewayRpcCall', () => {
    it('uses shared-token backend auth without device identity for a loopback Gateway', async () => {
      rpcHandler = () => ({ ok: true });

      await gatewayRpcCall('test.method', { foo: 'bar' });

      expect(createDeviceBlockMock).not.toHaveBeenCalled();
      expect(lastConnectParams).toMatchObject({
        client: {
          id: 'gateway-client',
          version: '0.2.0',
          mode: 'backend',
          platform: 'node',
        },
        auth: { token: 'test-token' },
      });
      expect(lastConnectParams).not.toHaveProperty('device');
    });

    it('requests gateway protocol v4 during connect handshake', async () => {
      rpcHandler = () => ({ ok: true });

      const { gatewayRpcCall } = await importFreshGatewayRpc();
      await gatewayRpcCall('test.method', { foo: 'bar' });

      expect(lastConnectParams).toMatchObject({
        minProtocol: 4,
        maxProtocol: 4,
      });
    });

    it('ignores a stored device token for a loopback Gateway', async () => {
      getStoredDeviceAuthMock.mockReturnValue({
        deviceId: 'device-123',
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        token: 'stored-device-token',
        updatedAt: new Date().toISOString(),
      });
      rpcHandler = () => ({ ok: true });

      const { gatewayRpcCall } = await importFreshGatewayRpc();
      await gatewayRpcCall('test.method', {});

      expect(lastConnectParams).toMatchObject({
        auth: { token: 'test-token' },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
      });
      expect(getStoredDeviceAuthMock).not.toHaveBeenCalled();
      expect(createDeviceBlockMock).not.toHaveBeenCalled();
    });

    it('reuses a stored device token for a remote Gateway WebSocket', async () => {
      gatewayConnectionModeMock.mockReturnValue('remote');
      getStoredDeviceAuthMock.mockReturnValue({
        deviceId: 'device-123',
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        token: 'stored-device-token',
        updatedAt: new Date().toISOString(),
      });
      rpcHandler = () => ({ ok: true });

      const { gatewayRpcCall } = await importFreshGatewayRpc();
      await gatewayRpcCall('test.method', {});

      expect(lastConnectParams).toMatchObject({
        auth: { token: 'stored-device-token' },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        device: {
          id: 'device-123',
          publicKey: 'pubkey-123',
          signature: 'sig-test-nonce',
          nonce: 'test-nonce',
        },
      });
      expect((lastConnectParams as { auth: Record<string, unknown> }).auth)
        .not.toHaveProperty('deviceToken');
      expect(createDeviceBlockMock).toHaveBeenCalledWith(expect.objectContaining({
        token: 'stored-device-token',
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
      }));
    });

    it('uses the shared token as remote pairing bootstrap when no device token is stored', async () => {
      gatewayConnectionModeMock.mockReturnValue('remote');
      rpcHandler = () => ({ ok: true });

      const { gatewayRpcCall } = await importFreshGatewayRpc();
      await gatewayRpcCall('test.method', {});

      expect(lastConnectParams).toMatchObject({
        auth: { token: 'test-token' },
        device: expect.objectContaining({ id: 'device-123' }),
      });
      expect(createDeviceBlockMock).toHaveBeenCalledWith(expect.objectContaining({
        token: 'test-token',
      }));
    });

    it('persists an issued device token only for a remote Gateway', async () => {
      connectPayload = {
        auth: {
          deviceToken: 'issued-device-token',
          role: 'operator',
          scopes: ['operator.read', 'operator.write'],
        },
      };
      rpcHandler = () => ({ ok: true });

      const localClient = await importFreshGatewayRpc();
      await localClient.gatewayRpcCall('test.method', {});
      expect(storeDeviceAuthMock).not.toHaveBeenCalled();

      localClient.closeGatewayRpc();
      gatewayConnectionModeMock.mockReturnValue('remote');
      const remoteClient = await importFreshGatewayRpc();
      await remoteClient.gatewayRpcCall('test.method', {});
      expect(storeDeviceAuthMock).toHaveBeenCalledWith(expect.objectContaining({
        token: 'issued-device-token',
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
      }));
    });

    it('never exposes a paired device token as a Gateway HTTP credential', async () => {
      gatewayConnectionModeMock.mockReturnValue('remote');
      getStoredDeviceAuthMock.mockReturnValue({
        deviceId: 'device-123',
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        token: 'stored-device-token',
        updatedAt: new Date().toISOString(),
      });

      const { getGatewaySharedHttpAuthToken } = await importFreshGatewayRpc();

      expect(getGatewaySharedHttpAuthToken()).toBe('test-token');
      expect(getStoredDeviceAuthMock).not.toHaveBeenCalled();
    });

    it('does not send a browser Origin header when legacy public origin is configured', async () => {
      process.env.CONVOSKETCHPAD_PUBLIC_ORIGIN = 'https://192.168.192.252:3443';
      rpcHandler = () => ({ ok: true });

      const { gatewayRpcCall } = await importFreshGatewayRpc();
      await gatewayRpcCall('test.method', { foo: 'bar' });

      expect(lastRequestOrigin).toBeUndefined();
    });

    it('does not reuse the browser API allowlist as a Gateway Origin', async () => {
      process.env.ALLOWED_ORIGINS = 'http://127.0.0.1:3080, https://192.168.192.252:3443';
      rpcHandler = () => ({ ok: true });

      const { gatewayRpcCall } = await importFreshGatewayRpc();
      await gatewayRpcCall('test.method', { foo: 'bar' });

      expect(lastRequestOrigin).toBeUndefined();
    });

    it('does not synthesize a localhost Origin header', async () => {
      rpcHandler = () => ({ ok: true });

      const { gatewayRpcCall } = await importFreshGatewayRpc();
      await gatewayRpcCall('test.method', { foo: 'bar' });

      expect(lastRequestOrigin).toBeUndefined();
    });

    it('sends RPC request and returns payload', async () => {
      rpcHandler = (method, params) => {
        expect(method).toBe('test.method');
        expect(params).toEqual({ foo: 'bar' });
        return { result: 'ok' };
      };

      const result = await gatewayRpcCall('test.method', { foo: 'bar' });
      expect(result).toEqual({ result: 'ok' });
    });

    it('rejects on RPC error response', async () => {
      rpcHandler = () => { throw new Error('not found'); };
      await expect(gatewayRpcCall('test.fail', {})).rejects.toThrow('not found');
    });

    it('classifies an explicit chat.send rejection as safe to fail', async () => {
      rpcHandler = () => { throw new Error('message rejected'); };
      await expect(gatewayDispatchCall('chat.send', {
        sessionKey: 'agent:main:test',
        message: 'hello',
        idempotencyKey: 'reservation-1',
      })).rejects.toMatchObject({ name: 'GatewayDispatchError', kind: 'rejected' });
    });

    it('classifies a disconnect after chat.send was written as an unknown outcome', async () => {
      closeOnRpcMethod = 'chat.send';
      await expect(gatewayDispatchCall('chat.send', {
        sessionKey: 'agent:main:test',
        message: 'hello',
        idempotencyKey: 'reservation-2',
      })).rejects.toMatchObject({ name: 'GatewayDispatchError', kind: 'outcome_unknown' });
    });

    it('handles multiple sequential calls on the same connection', async () => {
      let callCount = 0;
      rpcHandler = () => {
        callCount++;
        return { n: callCount };
      };

      const r1 = await gatewayRpcCall('call.one', {});
      const r2 = await gatewayRpcCall('call.two', {});
      expect(r1).toEqual({ n: 1 });
      expect(r2).toEqual({ n: 2 });
    });

    it('handles concurrent calls', async () => {
      rpcHandler = (_method, params) => {
        return { echo: (params as Record<string, unknown>).value };
      };

      const [r1, r2, r3] = await Promise.all([
        gatewayRpcCall('echo', { value: 'a' }),
        gatewayRpcCall('echo', { value: 'b' }),
        gatewayRpcCall('echo', { value: 'c' }),
      ]);
      expect(r1).toEqual({ echo: 'a' });
      expect(r2).toEqual({ echo: 'b' });
      expect(r3).toEqual({ echo: 'c' });
    });

    it('rejects when the gateway rejects the initial connect handshake', async () => {
      connectMode = 'reject';
      const { gatewayRpcCall } = await importFreshGatewayRpc();
      await expect(gatewayRpcCall('test.method', {})).rejects.toThrow('connect rejected by test server');
    });

    it('rejects when the socket closes before connect completes', async () => {
      connectMode = 'close';
      const { gatewayRpcCall } = await importFreshGatewayRpc();
      await expect(gatewayRpcCall('test.method', {})).rejects.toThrow(/closed before connect completed/i);
    });

    it('recovers when the Gateway becomes available after the initial handshake fails', async () => {
      connectMode = 'close';
      const client = await importFreshGatewayRpc();
      const states: string[] = [];
      const unsubscribe = client.subscribeGatewayStatus((status) => states.push(status.state));

      await vi.waitFor(() => expect(states.at(-1)).toBe('disconnected'));
      connectMode = 'accept';
      await vi.waitFor(() => expect(states).toContain('connected'), { timeout: 2_500 });

      unsubscribe();
      client.closeGatewayRpc();
    });

    it('closes the persistent connection and rejects later calls during shutdown', async () => {
      rpcHandler = () => ({ ok: true });
      const freshClient = await importFreshGatewayRpc();
      await freshClient.gatewayRpcCall('test.method', {});

      freshClient.closeGatewayRpc();

      await expect(freshClient.gatewayRpcCall('test.method', {}))
        .rejects.toThrow('Gateway RPC client is shutting down');
      await vi.waitFor(() => expect(wss.clients.size).toBe(0));
    });
  });

});
