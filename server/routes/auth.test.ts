/** Tests for the auth routes (login, logout, status). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

describe('auth routes', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function buildApp(
    configOverrides: Record<string, unknown> = {},
    secureRequest = false,
  ) {
    const baseConfig = {
      auth: true,
      gatewayToken: 'test-token',
      sessionSecret: 'test-secret-key-for-tests-only-1234',
      sessionTtlMs: 86400000,
      authMaxFailures: 3,
      authFailureWindowMs: 1800000,
      authLockoutMs: 1800000,
      port: 3000,
      host: '127.0.0.1',
      ...configOverrides,
    };

    vi.doMock('../lib/config.js', () => ({
      config: baseConfig,
      SESSION_COOKIE_NAME: 'convosketchpad_session_3000',
    }));
    vi.doMock('../middleware/rate-limit.js', () => ({
      rateLimitAuth: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
      getClientId: vi.fn(() => 'test-client'),
      isSecureRequest: vi.fn(() => secureRequest),
    }));
    vi.doMock('../lib/managed-users.js', () => ({
      authenticateManagedToken: vi.fn(async (token: string) => token === 'example-token'
        ? { userId: 'managed-user-1', name: 'Alice', tokenVersion: 1 }
        : null),
      resolveManagedSession: vi.fn((session: { sub?: string; name?: string; ver?: number } | null) => session?.sub && session.ver
        ? { userId: session.sub, name: session.name || 'User', tokenVersion: session.ver }
        : null),
    }));

    const mod = await import('./auth.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  describe('POST /api/auth/login', () => {
    it('returns ok when auth is disabled', async () => {
      const app = await buildApp({ auth: false });
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'anything' }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
    });

    it('returns 400 when token is missing', async () => {
      const app = await buildApp();
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when token is empty string', async () => {
      const app = await buildApp();
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: '   ' }),
      });
      expect(res.status).toBe(400);
    });

    it('accepts a simple user token', async () => {
      const app = await buildApp({ gatewayToken: 'my-secret-token' });
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'example-token' }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      expect(res.headers.get('set-cookie')).toContain('convosketchpad_session');
    });

    it('marks the session cookie Secure when HTTPS was verified by a trusted proxy', async () => {
      const app = await buildApp({}, true);
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'example-token' }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie')).toContain('Secure');
    });

    it('rejects the removed password field', async () => {
      const app = await buildApp();
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'example-token' }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Token required' });
    });

    it('rejects an unknown non-empty token without creating a user', async () => {
      const app = await buildApp();
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'wrong-token' }),
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Invalid token' });
    });

    it('locks the client for 30 minutes on the third failed verification', async () => {
      const app = await buildApp();
      for (let attempt = 1; attempt <= 2; attempt++) {
        const response = await app.request('/api/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: `wrong-${attempt}` }),
        });
        expect(response.status).toBe(401);
      }
      const locked = await app.request('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'wrong-3' }),
      });
      expect(locked.status).toBe(429);
      expect(locked.headers.get('Retry-After')).toBe('1800');
    });

    it('returns 400 for invalid JSON body', async () => {
      const app = await buildApp();
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears the session cookie', async () => {
      const app = await buildApp();
      const res = await app.request('/api/auth/logout', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      // Should have a set-cookie header clearing the cookie
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toBeTruthy();
    });
  });

  describe('GET /api/auth/status', () => {
    it('returns authEnabled: false when auth is disabled', async () => {
      const app = await buildApp({ auth: false });
      const res = await app.request('/api/auth/status');
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.authEnabled).toBe(false);
      expect(json.authenticated).toBe(true);
    });

    it('returns authenticated: false with no cookie when auth is enabled', async () => {
      const app = await buildApp();
      const res = await app.request('/api/auth/status');
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.authEnabled).toBe(true);
      expect(json.authenticated).toBe(false);
    });
  });
});
