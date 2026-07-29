import { describe, expect, it } from 'vitest';
import { isValidBindHost, isValidIpAddress } from './validators.js';

describe('setup network validators', () => {
  it('accepts supported bind addresses and hostnames', () => {
    expect(isValidBindHost('127.0.0.1')).toBe(true);
    expect(isValidBindHost('::')).toBe(true);
    expect(isValidBindHost('localhost')).toBe(true);
    expect(isValidBindHost('canvas.internal')).toBe(true);
  });

  it('rejects malformed bind hosts and distinguishes IP literals', () => {
    expect(isValidBindHost('https://canvas.example.test')).toBe(false);
    expect(isValidBindHost('-invalid.example')).toBe(false);
    expect(isValidBindHost('bad..example')).toBe(false);
    expect(isValidIpAddress('192.168.1.20')).toBe(true);
    expect(isValidIpAddress('canvas.internal')).toBe(false);
  });
});
