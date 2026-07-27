/**
 * Shared origin allowlist for browser-facing HTTP and SSE entrypoints.
 */

import { config } from './config.js';
import {
  isLoopbackHostname,
  parseConfiguredOrigins,
} from './browser-origin-policy.js';

const ALLOWED_ORIGINS = new Set([
  `http://localhost:${config.port}`,
  `http://127.0.0.1:${config.port}`,
]);

for (const origin of parseConfiguredOrigins(process.env.ALLOWED_ORIGINS).origins) {
  ALLOWED_ORIGINS.add(origin);
}

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return isLoopbackHostname(config.host);

  try {
    const parsed = new URL(origin);
    if (isLoopbackHostname(parsed.hostname)) return true;
    return ALLOWED_ORIGINS.has(parsed.origin);
  } catch {
    return false;
  }
}

export function resolveCorsOrigin(origin: string | undefined): string | null | undefined {
  return isAllowedOrigin(origin) ? origin : null;
}
