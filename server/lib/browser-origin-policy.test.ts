import { describe, expect, it } from 'vitest';
import {
  hasRemoteConfiguredOrigin,
  isLoopbackHostname,
  normalizeConfiguredOrigin,
  parseConfiguredOrigins,
} from './browser-origin-policy.js';

describe('browser origin policy', () => {
  it('normalizes exact HTTP(S) origins and removes duplicates', () => {
    expect(parseConfiguredOrigins(
      'https://canvas.example.test:443, https://canvas.example.test, http://127.0.0.1:3080',
    )).toEqual({
      origins: ['https://canvas.example.test', 'http://127.0.0.1:3080'],
      invalid: [],
    });
  });

  it('rejects paths, credentials, non-HTTP schemes, null, and wildcards', () => {
    expect(normalizeConfiguredOrigin('https://canvas.example.test/path')).toBeNull();
    expect(normalizeConfiguredOrigin('https://user:pass@canvas.example.test')).toBeNull();
    expect(normalizeConfiguredOrigin('wss://canvas.example.test')).toBeNull();
    expect(normalizeConfiguredOrigin('null')).toBeNull();
    expect(normalizeConfiguredOrigin('https://*.example.test')).toBeNull();
  });

  it('recognizes IPv4 and IPv6 loopback hosts and detects remote origins', () => {
    expect(isLoopbackHostname('127.9.8.7')).toBe(true);
    expect(isLoopbackHostname('[::1]')).toBe(true);
    expect(hasRemoteConfiguredOrigin([
      'http://localhost:3080',
      'http://[::1]:3080',
    ])).toBe(false);
    expect(hasRemoteConfiguredOrigin(['https://canvas.example.test'])).toBe(true);
  });
});
