/**
 * ConvoSketchpad server entry point.
 *
 * Starts the HTTP server behind an optional external TLS terminator, starts
 * all configured Agent Runtime connections, and registers graceful shutdown
 * handlers.
 * @module
 */

import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { config, validateConfig, printStartupBanner } from './lib/config.js';
import { runCanvasMediaBackfillMigration } from './lib/canvas-media-derivatives.js';
import { packageMetadata } from './lib/package-metadata.js';
import { createApplicationContext } from './application-context.js';

// ── Startup banner + validation ──────────────────────────────────────

printStartupBanner(packageMetadata.version, packageMetadata.description);
validateConfig();
const applicationContext = createApplicationContext();
const canvasStore = applicationContext.store;
if (!config.auth) canvasStore.ensureUser('local', 'Local User');
const app = createApp(applicationContext);

// ── HTTP server ──────────────────────────────────────────────────────

const httpServer = serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  },
  (info) => {
    console.log(`\x1b[33m[convosketchpad]\x1b[0m http://${config.host}:${info.port}`);
    void runCanvasMediaBackfillMigration(canvasStore).then((mediaMigration) => {
      if (!mediaMigration) return;
      console.log(JSON.stringify({
        level: mediaMigration.skipped > 0 ? 'warn' : 'info',
        subsystem: 'canvas_media',
        action: 'historical_thumbnail_backfill_completed',
        total: mediaMigration.total,
        hashed: mediaMigration.hashed,
        generated: mediaMigration.generated,
        reused: mediaMigration.reused,
        skipped: mediaMigration.skipped,
      }));
    }).catch((error) => {
      console.error(JSON.stringify({
        level: 'error',
        subsystem: 'canvas_media',
        action: 'historical_thumbnail_backfill_failed',
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  },
);

// Friendly error on port conflict
(httpServer as unknown as import('node:net').Server).on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\x1b[31m[convosketchpad]\x1b[0m Port ${config.port} is already in use. Is another instance running?`);
    process.exit(1);
  }
  throw err;
});

applicationContext.start();

// ── Graceful shutdown ────────────────────────────────────────────────

function shutdown(signal: string) {
  console.log(`\n[convosketchpad] ${signal} received, shutting down...`);

  applicationContext.close();

  httpServer.close(() => {
    console.log('[convosketchpad] HTTP server closed');
  });

  // Give connections 5s to drain, then force exit
  setTimeout(() => {
    console.log('[convosketchpad] Force exit');
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
