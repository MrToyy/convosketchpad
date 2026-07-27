import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('removed API surfaces', () => {
  const originalAuth = process.env.CONVOSKETCHPAD_AUTH;

  beforeEach(() => {
    vi.resetModules();
    process.env.CONVOSKETCHPAD_AUTH = 'false';
  });

  afterEach(() => {
    if (originalAuth === undefined) {
      delete process.env.CONVOSKETCHPAD_AUTH;
    } else {
      process.env.CONVOSKETCHPAD_AUTH = originalAuth;
    }
  });

  it('returns 404 for every retired product API family', async () => {
    const { default: app } = await import('./app.js');
    const retiredPaths = [
      '/api/kanban/tasks',
      '/api/sessions',
      '/api/memories',
      '/api/workspace',
      '/api/crons',
      '/api/skills',
      '/api/tts',
      '/api/transcribe',
    ];
    for (const path of retiredPaths) {
      expect((await app.request(path)).status, path).toBe(404);
    }
  });

  it('rejects browser API requests from unapproved origins', async () => {
    const { default: app } = await import('./app.js');
    const response = await app.request('/api/runtime/status', {
      headers: { Origin: 'https://unapproved.example.test' },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Origin not allowed' });
  });

  it('does not expose the removed Agent log API', async () => {
    const { default: app } = await import('./app.js');
    expect((await app.request('/api/agentlog')).status).toBe(404);
    expect((await app.request('/api/agentlog', { method: 'POST' })).status).toBe(404);
  });
});
