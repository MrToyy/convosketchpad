import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('removed API surfaces', () => {
  const originalAuth = process.env.NERVE_AUTH;

  beforeEach(() => {
    vi.resetModules();
    process.env.NERVE_AUTH = 'false';
  });

  afterEach(() => {
    if (originalAuth === undefined) {
      delete process.env.NERVE_AUTH;
    } else {
      process.env.NERVE_AUTH = originalAuth;
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
});
