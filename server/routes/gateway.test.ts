import { describe, expect, it } from 'vitest';
import app from './gateway.js';

describe('Canvas-only Gateway HTTP surface', () => {
  it.each(['/api/gateway/models', '/api/gateway/session-info'])('does not expose %s', async (path) => {
    expect((await app.request(path)).status).toBe(404);
  });

  it('does not expose session patching', async () => {
    expect((await app.request('/api/gateway/session-patch', { method: 'POST' })).status).toBe(404);
  });
});
