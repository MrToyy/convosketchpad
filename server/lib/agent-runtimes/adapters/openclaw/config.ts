import 'dotenv/config';

export const DEFAULT_OPENCLAW_GATEWAY_URL = 'http://127.0.0.1:18789';

const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export const openClawConfig = {
  gatewayUrl: process.env.OPENCLAW_GATEWAY_URL || DEFAULT_OPENCLAW_GATEWAY_URL,
  gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN || '',
  gatewayTimezone: process.env.OPENCLAW_GATEWAY_TIMEZONE?.trim() || localTimezone,
} as const;

export interface OpenClawConfigValidation {
  warnings: string[];
  errors: string[];
}

export function validateOpenClawConfig(): OpenClawConfigValidation {
  const warnings: string[] = [];
  const errors: string[] = [];
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: openClawConfig.gatewayTimezone }).format();
  } catch {
    errors.push(
      `Invalid OPENCLAW_GATEWAY_TIMEZONE: ${openClawConfig.gatewayTimezone}. `
      + 'Expected an IANA timezone such as Asia/Shanghai.',
    );
  }
  if (!openClawConfig.gatewayToken) {
    warnings.push(
      'OPENCLAW_GATEWAY_TOKEN is not set; OpenClaw Gateway calls will fail until it is configured.',
    );
  }
  return { warnings, errors };
}
