/**
 * Authentication routes — login, logout, and status.
 *
 * POST /api/auth/login  — Identify with a trusted-user token, receive session cookie.
 * POST /api/auth/logout — Clear session cookie.
 * GET  /api/auth/status — Check auth configuration and current session state.
 * @module
 */

import { Hono, type Context } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { config, SESSION_COOKIE_NAME } from '../lib/config.js';
import { createSession, verifySession } from '../lib/session.js';
import { authenticateManagedToken, resolveManagedSession } from '../lib/managed-users.js';
import { LoginFailureTracker, type LoginLockout } from '../lib/login-failures.js';
import { getClientId, isSecureRequest, rateLimitAuth } from '../middleware/rate-limit.js';

const app = new Hono();
export const loginFailureTracker = new LoginFailureTracker({
  maxFailures: config.authMaxFailures,
  windowMs: config.authFailureWindowMs,
  lockoutMs: config.authLockoutMs,
});
const loginFailureCleanup = setInterval(() => loginFailureTracker.evictExpired(), 5 * 60 * 1000);
loginFailureCleanup.unref();

function lockoutResponse(c: Context, lockout: LoginLockout) {
  c.header('Retry-After', String(lockout.retryAfterSeconds));
  c.header('X-RateLimit-Remaining', '0');
  return c.json({ error: 'Too many failed login attempts' }, 429);
}

/**
 * POST /api/auth/login
 * Accepts { token: string }.
 * Sets HttpOnly session cookie on success.
 */
app.post('/api/auth/login', rateLimitAuth, async (c) => {
  // If auth is disabled, always succeed
  if (!config.auth) {
    return c.json({ ok: true, message: 'Auth disabled' });
  }

  try {
    const body = await c.req.json() as { token?: string };
    const token = body.token?.trim();

    if (!token) {
      return c.json({ error: 'Token required' }, 400);
    }
    if (token.length > 256) return c.json({ error: 'Invalid token' }, 400);

    const clientId = getClientId(c);
    const existingLockout = loginFailureTracker.check(clientId);
    if (existingLockout.locked) return lockoutResponse(c, existingLockout);

    const identity = await authenticateManagedToken(token);
    if (!identity) {
      const lockout = loginFailureTracker.recordFailure(clientId);
      if (lockout.locked) return lockoutResponse(c, lockout);
      return c.json({ error: 'Invalid token' }, 401);
    }
    loginFailureTracker.recordSuccess(clientId);

    // Create signed session token
    const sessionToken = createSession(config.sessionSecret, config.sessionTtlMs, identity);

    // Set HttpOnly, SameSite=Strict cookie
    setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: 'Strict',
      secure: isSecureRequest(c),
      path: '/',
      maxAge: Math.floor(config.sessionTtlMs / 1000),
    });

    return c.json({ ok: true, user: { id: identity.userId, name: identity.name } });
  } catch {
    return c.json({ error: 'Invalid request' }, 400);
  }
});

/**
 * POST /api/auth/logout
 * Clears the session cookie.
 */
app.post('/api/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});

/**
 * GET /api/auth/status
 * Returns whether auth is enabled and whether the current request is authenticated.
 */
app.get('/api/auth/status', (c) => {
  if (!config.auth) {
    return c.json({ authEnabled: false, authenticated: true, user: { id: 'local', name: 'Local User' } });
  }

  const token = getCookie(c, SESSION_COOKIE_NAME);
  const session = token ? verifySession(token, config.sessionSecret) : null;
  const identity = resolveManagedSession(session);

  return c.json({
    authEnabled: true,
    authenticated: !!identity,
    user: identity ? { id: identity.userId, name: identity.name } : null,
  });
});

export default app;
