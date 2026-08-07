/**
 * Authentication middleware for Hono.
 *
 * When `CONVOSKETCHPAD_AUTH` is enabled, requires a valid signed session cookie on all
 * `/api/*` routes except public ones (auth endpoints, health check). Static
 * files and SPA routes pass through — the frontend login gate handles those.
 * @module
 */

import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { config, SESSION_COOKIE_NAME } from '../lib/config.js';
import { verifySession } from '../lib/session.js';
import { resolveManagedSession } from '../lib/managed-users.js';
import type { CanvasStore } from '../lib/canvas/persistence/canvas-store.js';

/** Routes that don't require authentication */
const PUBLIC_ROUTES = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/status',
  '/api/health',
  '/api/version',
  '/health',
];

/**
 * Authentication middleware.
 * When CONVOSKETCHPAD_AUTH is enabled, requires a valid signed session cookie
 * on all /api/* routes except public ones. Static files pass through.
 */
export function createAuthMiddleware(store?: CanvasStore) {
  return createMiddleware(async (c, next) => {
    // Auth disabled — pass through everything
    if (!config.auth) {
      const identity = { userId: 'local', name: 'Local User' };
      c.set('canvasIdentity', identity);
      return next();
    }

    // Non-API routes (static files, SPA) — pass through
    // The frontend login gate handles rendering the login page
    if (!c.req.path.startsWith('/api/') && c.req.path !== '/health') return next();

    // Public API routes — always accessible
    if (PUBLIC_ROUTES.some(route => c.req.path === route)) return next();

    // Check session cookie
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (!token) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const session = resolveManagedSession(verifySession(token, config.sessionSecret), store);
    if (!session) {
      return c.json({ error: 'Invalid or expired session' }, 401);
    }

    c.set('canvasIdentity', { userId: session.userId, name: session.name });
    return next();
  });
}

export const authMiddleware = createAuthMiddleware();
