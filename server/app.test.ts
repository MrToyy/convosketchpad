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

  it('returns 404 for the retired Kanban API', async () => {
    const { default: app } = await import('./app.js');
    const response = await app.request('/api/kanban/tasks');

    expect(response.status).toBe(404);
  });
});
