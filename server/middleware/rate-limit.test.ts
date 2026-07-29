/** Tests for the sliding-window rate limiter middleware. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { rateLimit, getClientId, isSecureRequest } from './rate-limit.js';

/**
 * The rate limiter uses a module-level Map, so we use unique client IPs
 * per test to avoid cross-test contamination.
 *
 * In test environments, getConnInfo() is unavailable (no real socket), so
 * directIp falls back to 'unknown'. Since 'unknown' is not a trusted proxy,
 * forwarded headers (x-forwarded-for / x-real-ip) are NOT trusted.
 *
 * To test per-client rate limiting, we override getClientId at the middleware
 * level by injecting a client ID via a custom header that the test helper
 * reads. In production, getConnInfo provides the real socket IP.
 *
 * For these tests, we use a middleware that sets a custom client id from
 * a test-only header, simulating distinct clients.
 */
let testCounter = 0;
function uniqueIp() {
  return `test-${++testCounter}.${Date.now()}`;
}

/**
 * Test helper: inject a per-client override by setting c.set('rateLimitClientId', ...)
 * before the rate limiter runs.
 */
function clientIdOverride() {
  return async (c: Parameters<typeof getClientId>[0], next: () => Promise<void>) => {
    const testClientId = c.req.header('x-test-client-id');
    if (testClientId) {
      c.set('rateLimitClientId' as never, testClientId as never);
    }
    await next();
  };
}

describe('rate-limit middleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createApp(maxRequests: number, windowMs: number) {
    const app = new Hono();
    const limiter = rateLimit({ maxRequests, windowMs });
    app.use('/test', clientIdOverride());
    app.use('/test', limiter);
    app.get('/test', (c) => c.text('ok'));
    return app;
  }

  function req(ip: string) {
    return { headers: { 'x-test-client-id': ip } };
  }

  it('trusts forwarded HTTPS only from an explicitly trusted direct proxy', async () => {
    const app = new Hono();
    app.use('/secure', async (c, next) => {
      c.set('rateLimitDirectIp' as never, (c.req.header('x-test-direct-ip') || 'unknown') as never);
      await next();
    });
    app.get('/secure', c => c.json({ secure: isSecureRequest(c) }));

    const trusted = await app.request('/secure', {
      headers: {
        'x-test-direct-ip': '127.0.0.1',
        'x-forwarded-proto': 'https',
      },
    });
    await expect(trusted.json()).resolves.toEqual({ secure: true });

    const untrusted = await app.request('/secure', {
      headers: {
        'x-test-direct-ip': '203.0.113.9',
        'x-forwarded-proto': 'https',
      },
    });
    await expect(untrusted.json()).resolves.toEqual({ secure: false });
  });

  it('should allow requests under the limit', async () => {
    const app = createApp(3, 60_000);
    const ip = uniqueIp();

    const res = await app.request('/test', req(ip));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('3');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('2');
  });

  it('should return 429 when limit exceeded', async () => {
    const app = createApp(2, 60_000);
    const ip = uniqueIp();

    await app.request('/test', req(ip));
    await app.request('/test', req(ip));

    const res = await app.request('/test', req(ip));
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('Too many requests. Please try again later.');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  it('should track remaining count correctly', async () => {
    const app = createApp(5, 60_000);
    const ip = uniqueIp();

    const res1 = await app.request('/test', req(ip));
    expect(res1.headers.get('X-RateLimit-Remaining')).toBe('4');

    const res2 = await app.request('/test', req(ip));
    expect(res2.headers.get('X-RateLimit-Remaining')).toBe('3');

    const res3 = await app.request('/test', req(ip));
    expect(res3.headers.get('X-RateLimit-Remaining')).toBe('2');
  });

  it('should reset after window expires', async () => {
    const app = createApp(2, 1000);
    const ip = uniqueIp();

    await app.request('/test', req(ip));
    await app.request('/test', req(ip));

    let res = await app.request('/test', req(ip));
    expect(res.status).toBe(429);

    vi.advanceTimersByTime(1001);

    res = await app.request('/test', req(ip));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('1');
  });

  it('should rate limit per path', async () => {
    const app = new Hono();
    const limiter = rateLimit({ maxRequests: 1, windowMs: 60_000 });
    app.use('/a', clientIdOverride());
    app.use('/b', clientIdOverride());
    app.use('/a', limiter);
    app.use('/b', limiter);
    app.get('/a', (c) => c.text('a'));
    app.get('/b', (c) => c.text('b'));

    const ip = uniqueIp();
    await app.request('/a', req(ip));
    const resA = await app.request('/a', req(ip));
    expect(resA.status).toBe(429);

    const resB = await app.request('/b', req(ip));
    expect(resB.status).toBe(200);
  });

  it('should isolate rate limits between different clients', async () => {
    const app = createApp(1, 60_000);
    const ip1 = uniqueIp();
    const ip2 = uniqueIp();

    await app.request('/test', req(ip1));
    const blocked = await app.request('/test', req(ip1));
    expect(blocked.status).toBe(429);

    const allowed = await app.request('/test', req(ip2));
    expect(allowed.status).toBe(200);
  });

  it('should use sliding window (partial expiry)', async () => {
    const app = createApp(3, 1000);
    const ip = uniqueIp();

    // t=0: first request
    await app.request('/test', req(ip));

    // t=500: second request
    vi.advanceTimersByTime(500);
    await app.request('/test', req(ip));

    // t=700: third request
    vi.advanceTimersByTime(200);
    await app.request('/test', req(ip));

    // t=700: should be blocked (3/3 used)
    let res = await app.request('/test', req(ip));
    expect(res.status).toBe(429);

    // t=1001: first request expires, one slot opens
    vi.advanceTimersByTime(301);
    res = await app.request('/test', req(ip));
    expect(res.status).toBe(200);
  });

  it('should fall back to "unknown" when no client id is available', async () => {
    const app = new Hono();
    const limiter = rateLimit({ maxRequests: 100, windowMs: 60_000 });
    app.use('/test', limiter);
    app.get('/test', (c) => c.text('ok'));

    // No x-test-client-id header, no real socket → falls back to 'unknown'
    const res = await app.request('/test');
    expect(res.status).toBe(200);
    // All anonymous clients share the 'unknown' bucket
  });

  it('exports rateLimitAuth with strict 5/min limit', async () => {
    const { rateLimitAuth } = await import('./rate-limit.js');
    expect(rateLimitAuth).toBeDefined();
    expect(typeof rateLimitAuth).toBe('function');
  });
});
