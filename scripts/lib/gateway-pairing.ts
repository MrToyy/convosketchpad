import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import {
  CONVOSKETCHPAD_OPERATOR_SCOPES,
  createDeviceBlock,
  storeDeviceAuth,
} from '../../server/lib/agent-runtimes/adapters/openclaw/device-identity.js';
import { packageMetadata } from './package-metadata.js';
import {
  CONVOSKETCHPAD_GATEWAY_CLIENT_ID,
  CONVOSKETCHPAD_GATEWAY_CLIENT_MODE,
  CONVOSKETCHPAD_GATEWAY_CLIENT_PLATFORM,
} from '../../server/lib/agent-runtimes/adapters/openclaw/gateway-client-identity.js';

const PAIRING_TIMEOUT_MS = 12_000;

export interface GatewayPairingProbeResult {
  ok: boolean;
  status: 'connected' | 'pending' | 'failed';
  requestId?: string;
  message: string;
}

interface PairingGatewayMessage {
  type?: string;
  event?: string;
  id?: string;
  ok?: boolean;
  payload?: {
    nonce?: string;
    auth?: {
      deviceToken?: string;
      role?: string;
      scopes?: string[];
    };
  };
  error?: {
    message?: string;
    details?: {
      code?: string;
      requestId?: string;
    };
  };
}

function gatewayWsUrl(gatewayUrl: string): string {
  const url = new URL(gatewayUrl);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (!url.pathname || url.pathname === '/') url.pathname = '/ws';
  return url.toString();
}

/**
 * Use ConvoSketchpad's persistent identity to create (or confirm) the native
 * OpenClaw pending pairing request. Approval remains an explicit CLI action.
 */
export function requestGatewayPairing(input: {
  gatewayUrl: string;
  gatewayToken: string;
}): Promise<GatewayPairingProbeResult> {
  return new Promise((resolve) => {
    const url = gatewayWsUrl(input.gatewayUrl);
    const socket = new WebSocket(url);
    const requestId = `convosketchpad-pair-${randomUUID()}`;
    let settled = false;

    const finish = (result: GatewayPairingProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({
        ok: false,
        status: 'failed',
        message: 'Timed out while requesting OpenClaw device pairing',
      });
    }, PAIRING_TIMEOUT_MS);

    socket.on('message', (data: Buffer | string) => {
      let message: PairingGatewayMessage;
      try {
        message = JSON.parse(data.toString()) as PairingGatewayMessage;
      } catch {
        return;
      }

      if (
        message.type === 'event'
        && message.event === 'connect.challenge'
        && typeof message.payload?.nonce === 'string'
      ) {
        const scopes = [...CONVOSKETCHPAD_OPERATOR_SCOPES];
        const clientId = CONVOSKETCHPAD_GATEWAY_CLIENT_ID;
        const clientMode = CONVOSKETCHPAD_GATEWAY_CLIENT_MODE;
        socket.send(JSON.stringify({
          type: 'req',
          id: requestId,
          method: 'connect',
          params: {
            minProtocol: 4,
            maxProtocol: 4,
            client: {
              id: clientId,
              displayName: 'ConvoSketchpad',
              version: packageMetadata.version,
              platform: CONVOSKETCHPAD_GATEWAY_CLIENT_PLATFORM,
              mode: clientMode,
              instanceId: `convosketchpad-setup-${randomUUID()}`,
            },
            role: 'operator',
            scopes,
            caps: ['tool-events'],
            auth: { token: input.gatewayToken },
            device: createDeviceBlock({
              clientId,
              clientMode,
              role: 'operator',
              scopes,
              token: input.gatewayToken,
              nonce: message.payload.nonce,
            }),
          },
        }));
        return;
      }

      if (message.type !== 'res' || message.id !== requestId) return;
      if (message.ok) {
        const auth = message.payload?.auth;
        if (auth?.deviceToken) {
          storeDeviceAuth({
            gatewayUrl: url,
            token: auth.deviceToken,
            role: auth.role,
            scopes: auth.scopes,
          });
        }
        finish({
          ok: true,
          status: 'connected',
          message: 'ConvoSketchpad device is already paired',
        });
        return;
      }

      const details = message.error?.details;
      if (details?.code === 'PAIRING_REQUIRED') {
        finish({
          ok: true,
          status: 'pending',
          requestId: details.requestId,
          message: details.requestId
            ? `OpenClaw pairing approval required: ${details.requestId}`
            : 'OpenClaw pairing approval required',
        });
        return;
      }

      finish({
        ok: false,
        status: 'failed',
        message: message.error?.message || 'OpenClaw rejected the pairing probe',
      });
    });

    socket.on('error', (error) => {
      finish({ ok: false, status: 'failed', message: error.message });
    });
    socket.on('close', (code, reason) => {
      if (!settled) {
        finish({
          ok: false,
          status: 'failed',
          message: `Gateway closed during pairing (${code}): ${reason.toString()}`,
        });
      }
    });
  });
}
