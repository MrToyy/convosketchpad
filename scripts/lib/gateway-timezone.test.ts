import { describe, expect, it } from 'vitest';
import { generateEnvContent } from './env-writer.js';
import {
  isRemoteGatewayUrl,
  isValidIanaTimezone,
} from './gateway-timezone.js';

describe('Gateway timezone setup helpers', () => {
  it.each([
    'http://localhost:18789',
    'http://127.0.1.1:18789',
    'http://[::1]:18789',
    'http://[0:0:0:0:0:0:0:1]:18789',
  ])('treats %s as a local Gateway', (url) => {
    expect(isRemoteGatewayUrl(url)).toBe(false);
  });

  it('detects remote Gateway URLs', () => {
    expect(isRemoteGatewayUrl('https://gateway.example.com')).toBe(true);
    expect(isRemoteGatewayUrl('http://10.0.0.5:18789')).toBe(true);
  });

  it('validates IANA timezone names', () => {
    expect(isValidIanaTimezone('Asia/Shanghai')).toBe(true);
    expect(isValidIanaTimezone('America/New_York')).toBe(true);
    expect(isValidIanaTimezone('Mars/Olympus')).toBe(false);
  });

  it('writes the configured Gateway timezone to .env', () => {
    expect(generateEnvContent({
      GATEWAY_TOKEN: 'secret',
      CONVOSKETCHPAD_GATEWAY_TIMEZONE: 'Asia/Shanghai',
    })).toContain('CONVOSKETCHPAD_GATEWAY_TIMEZONE=Asia/Shanghai');
  });
});
