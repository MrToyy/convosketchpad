export const CONVOSKETCHPAD_GATEWAY_CLIENT_ID = 'gateway-client';
export const CONVOSKETCHPAD_GATEWAY_CLIENT_MODE = 'backend';
export const CONVOSKETCHPAD_GATEWAY_CLIENT_PLATFORM = 'node';

export type GatewayConnectionMode = 'loopback' | 'remote';

function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  return normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized;
}

/** Match the direct-loopback trust boundary supported by the OpenClaw backend client. */
export function gatewayConnectionMode(gatewayUrl: string | URL): GatewayConnectionMode {
  try {
    const parsed = gatewayUrl instanceof URL ? gatewayUrl : new URL(gatewayUrl);
    const hostname = normalizeHostname(parsed.hostname);
    const loopback = hostname === 'localhost'
      || hostname === '::1'
      || hostname === '0:0:0:0:0:0:0:1'
      || /^127(?:\.\d{1,3}){3}$/.test(hostname);
    return loopback ? 'loopback' : 'remote';
  } catch {
    return 'remote';
  }
}

export function gatewayRequiresDevicePairing(gatewayUrl: string | URL): boolean {
  return gatewayConnectionMode(gatewayUrl) === 'remote';
}
