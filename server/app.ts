/**
 * Hono app definition + middleware stack.
 *
 * Assembles all middleware (CORS, security headers, body limits, compression,
 * cache-control) and mounts every API route under `/api/`. Also serves the
 * Vite-built SPA from `dist/` with a catch-all fallback to `index.html`.
 * @module
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';

import { cacheHeaders } from './middleware/cache-headers.js';
import { errorHandler } from './middleware/error-handler.js';
import { securityHeaders } from './middleware/security-headers.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { config } from './lib/config.js';
import { isAllowedOrigin, resolveCorsOrigin } from './lib/origin-utils.js';

import { createHealthRoutes } from './routes/health.js';
import { createAuthRoutes } from './routes/auth.js';
import { createRuntimeUsageRoutes } from './routes/runtime-usage.js';
import versionRoutes from './routes/version.js';
import versionCheckRoutes from './routes/version-check.js';
import { createRuntimeActionRoutes } from './routes/runtime-actions.js';
import { createUploadReferenceRoutes } from './routes/upload-reference.js';
import { createCanvasRoutes } from './routes/canvas.js';
import { createRuntimeRoutes } from './routes/runtime.js';
import type { ApplicationContext } from './application-context.js';

export function createApp(context: Pick<ApplicationContext, 'runtimes' | 'store' | 'shutdownSignal'>): Hono {
  const app = new Hono();

  // ── Middleware ────────────────────────────────────────────────────────

  app.onError(errorHandler);
  app.use('*', logger());
  app.use(
    '*',
    cors({
      origin: resolveCorsOrigin,
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin && !isAllowedOrigin(origin)) {
      return c.json({ error: 'Origin not allowed' }, 403);
    }
    return next();
  });
  app.use('*', securityHeaders);
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: config.limits.maxBodyBytes,
      onError: (c) => c.text('Request body too large', 413),
    }),
  );
  // Authentication — after bodyLimit (reject oversized before auth), before compress/routes
  app.use('*', createAuthMiddleware(context.store));
  app.use('*', compress());
  app.use('*', cacheHeaders);

  // ── API routes ───────────────────────────────────────────────────────

  const routes = [
    createHealthRoutes(context.runtimes),
    createAuthRoutes(context.store),
    createRuntimeUsageRoutes(context.runtimes),
    versionRoutes,
    versionCheckRoutes,
    createRuntimeActionRoutes(context.runtimes),
    createUploadReferenceRoutes(context.store),
    createCanvasRoutes({
      store: context.store,
      runtimes: context.runtimes,
      shutdownSignal: context.shutdownSignal,
    }),
    createRuntimeRoutes(context.runtimes, context.shutdownSignal),
  ];
  for (const route of routes) app.route('/', route);

  // ── Static files + SPA fallback ──────────────────────────────────────

  app.use('/assets/*', serveStatic({ root: './dist/' }));
  // Serve static files but skip API routes
  app.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return next();
    return serveStatic({ root: './dist/' })(c, next);
  });
  // SPA fallback — serve index.html only for extensionless app routes.
  // If a hashed asset or other static file is missing, return 404 instead of
  // silently serving index.html. That avoids stale post-upgrade bundles loading
  // HTML as JavaScript after a deploy/release switch.
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return next();

    // Match a real file extension at the end of the path (e.g., `.js`, `.css`, `.map`)
    // rather than any dot anywhere in the path. The previous `.includes('.')`
    // would 404 paths like `/.well-known/acme-challenge/<token>` or any future
    // app route with a dot in a directory segment.
    const looksLikeStaticFile = c.req.path.startsWith('/assets/') || /\.[a-zA-Z0-9]+$/.test(c.req.path);
    if (looksLikeStaticFile) {
      return c.notFound();
    }

    return serveStatic({ root: './dist/', path: 'index.html' })(c, next);
  });

  return app;
}
