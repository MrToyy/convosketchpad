import { describe, expect, it } from 'vitest';
import app, { gatewayIsLocal } from './gateway.js';

describe('Canvas-only Gateway HTTP surface', () => {
  it('only treats loopback Gateway URLs as locally restartable', () => {
    expect(gatewayIsLocal('http://127.0.0.1:18789')).toBe(true);
    expect(gatewayIsLocal('ws://localhost:18789/ws')).toBe(true);
    expect(gatewayIsLocal('https://gateway.example.com')).toBe(false);
  });
  it.each(['/api/gateway/models', '/api/gateway/session-info'])('does not expose %s', async (path) => {
    expect((await app.request(path)).status).toBe(404);
  });

  it('does not expose session patching', async () => {
    expect((await app.request('/api/gateway/session-patch', { method: 'POST' })).status).toBe(404);
  });
});
