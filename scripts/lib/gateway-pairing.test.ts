import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const {
  createDeviceBlockMock,
  storeDeviceAuthMock,
} = vi.hoisted(() => ({
  createDeviceBlockMock: vi.fn(() => ({
    id: 'convosketchpad-device',
    publicKey: 'convosketchpad-public-key',
    signature: 'signed-challenge',
    signedAt: 1,
    nonce: 'pairing-nonce',
  })),
  storeDeviceAuthMock: vi.fn(),
}));

vi.mock('../../server/lib/agent-runtimes/adapters/openclaw/device-identity.js', () => ({
  CONVOSKETCHPAD_OPERATOR_SCOPES: ['operator.read', 'operator.write', 'operator.approvals'],
  createDeviceBlock: createDeviceBlockMock,
  storeDeviceAuth: storeDeviceAuthMock,
}));

import { requestGatewayPairing } from './gateway-pairing.js';
import { packageMetadata } from './package-metadata.js';

describe('native Gateway pairing probe', () => {
  let server: Server;
  let wss: WebSocketServer;
  let port = 0;

  beforeEach(async () => {
    createDeviceBlockMock.mockClear();
    storeDeviceAuthMock.mockClear();
    server = createServer();
    wss = new WebSocketServer({ server });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        port = typeof address === 'object' && address ? address.port : 0;
        resolve();
      });
    });
  });

  afterEach(async () => {
    for (const client of wss.clients) client.close();
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('creates a native pending request with only operator read/write scopes', async () => {
    let receivedOrigin: string | undefined;
    let receivedPath = '';
    let connectParams: Record<string, unknown> | null = null;
    wss.on('connection', (socket: WebSocket, request) => {
      receivedOrigin = request.headers.origin;
      receivedPath = request.url || '';
      socket.send(JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'pairing-nonce' },
      }));
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString());
        connectParams = message.params;
        socket.send(JSON.stringify({
          type: 'res',
          id: message.id,
          ok: false,
          error: {
            message: 'pairing required',
            details: {
              code: 'PAIRING_REQUIRED',
              requestId: 'native-request-1',
            },
          },
        }));
      });
    });

    const result = await requestGatewayPairing({
      gatewayUrl: `http://127.0.0.1:${port}`,
      gatewayToken: 'shared-gateway-token',
    });

    expect(result).toEqual({
      ok: true,
      status: 'pending',
      requestId: 'native-request-1',
      message: 'OpenClaw pairing approval required: native-request-1',
    });
    expect(receivedOrigin).toBeUndefined();
    expect(receivedPath).toBe('/ws');
    expect(connectParams).toMatchObject({
      minProtocol: 4,
      maxProtocol: 4,
      role: 'operator',
      scopes: ['operator.read', 'operator.write', 'operator.approvals'],
      auth: { token: 'shared-gateway-token' },
      client: {
        id: 'gateway-client',
        displayName: 'ConvoSketchpad',
        version: packageMetadata.version,
        mode: 'backend',
      },
      device: { id: 'convosketchpad-device' },
    });
    expect(createDeviceBlockMock).toHaveBeenCalledWith({
      clientId: 'gateway-client',
      clientMode: 'backend',
      role: 'operator',
      scopes: ['operator.read', 'operator.write', 'operator.approvals'],
      token: 'shared-gateway-token',
      nonce: 'pairing-nonce',
    });
  });

  it('stores the primary hello device token on successful connect', async () => {
    wss.on('connection', (socket: WebSocket) => {
      socket.send(JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'pairing-nonce' },
      }));
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString());
        socket.send(JSON.stringify({
          type: 'res',
          id: message.id,
          ok: true,
          payload: {
            auth: {
              deviceToken: 'issued-device-token',
              role: 'operator',
              scopes: ['operator.read', 'operator.write'],
            },
          },
        }));
      });
    });

    const result = await requestGatewayPairing({
      gatewayUrl: `http://127.0.0.1:${port}`,
      gatewayToken: 'shared-gateway-token',
    });

    expect(result).toMatchObject({ ok: true, status: 'connected' });
    expect(storeDeviceAuthMock).toHaveBeenCalledWith({
      gatewayUrl: `ws://127.0.0.1:${port}/ws`,
      token: 'issued-device-token',
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
    });
  });

  it('surfaces a native Gateway rejection without approving anything', async () => {
    wss.on('connection', (socket: WebSocket) => {
      socket.send(JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'pairing-nonce' },
      }));
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString());
        socket.send(JSON.stringify({
          type: 'res',
          id: message.id,
          ok: false,
          error: { message: 'origin not allowed' },
        }));
      });
    });

    const result = await requestGatewayPairing({
      gatewayUrl: `http://127.0.0.1:${port}`,
      gatewayToken: 'shared-gateway-token',
    });

    expect(result).toEqual({
      ok: false,
      status: 'failed',
      message: 'origin not allowed',
    });
    expect(storeDeviceAuthMock).not.toHaveBeenCalled();
  });
});
