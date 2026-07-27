/**
 * ConvoSketchpad server entry point.
 *
 * Starts the HTTP server behind an optional external TLS terminator, starts
 * the backend-owned OpenClaw connection, and registers graceful shutdown
 * handlers.
 * @module
 */

import { serve } from '@hono/node-server';
import app from './app.js';
import { config, validateConfig, printStartupBanner, probeGateway } from './lib/config.js';
import { startCanvasReconciler, stopCanvasReconciler } from './lib/canvas-reconciler.js';
import { closeGatewayRpc } from './lib/gateway-rpc.js';
import { startCanvasSendCoordinator, stopCanvasSendCoordinator } from './lib/canvas-send-coordinator.js';
import { packageMetadata } from './lib/package-metadata.js';

// ── Startup banner + validation ──────────────────────────────────────

printStartupBanner(packageMetadata.version, packageMetadata.description);
validateConfig();

// ── HTTP server ──────────────────────────────────────────────────────

const httpServer = serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  },
  (info) => {
    console.log(`\x1b[33m[convosketchpad]\x1b[0m http://${config.host}:${info.port}`);
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

// Non-blocking gateway health check
probeGateway();
startCanvasReconciler();
startCanvasSendCoordinator();

// ── Graceful shutdown ────────────────────────────────────────────────

function shutdown(signal: string) {
  console.log(`\n[convosketchpad] ${signal} received, shutting down...`);

  stopCanvasReconciler();
  stopCanvasSendCoordinator();
  closeGatewayRpc();

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
