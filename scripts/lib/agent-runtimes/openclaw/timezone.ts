import { gatewayRequiresDevicePairing } from '../../../../server/lib/agent-runtimes/adapters/openclaw/setup-support.js';

export function localIanaTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function isValidIanaTimezone(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).format();
    return true;
  } catch {
    return false;
  }
}

export function isRemoteGatewayUrl(value: string): boolean {
  return gatewayRequiresDevicePairing(value);
}
