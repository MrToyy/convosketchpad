import { describe, expect, it } from 'vitest';
import { gatewayIsLocal } from './restart.js';

describe('OpenClaw Gateway restart boundary', () => {
  it('only treats loopback Gateway URLs as locally restartable', () => {
    expect(gatewayIsLocal('http://127.0.0.1:18789')).toBe(true);
    expect(gatewayIsLocal('ws://localhost:18789/ws')).toBe(true);
    expect(gatewayIsLocal('https://gateway.example.com')).toBe(false);
  });
});
