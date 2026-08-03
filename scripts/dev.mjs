/**
 * Starts the Vite client and watch-mode server behind one browser-facing port.
 *
 * The server keeps its own internal port so Vite can proxy HTTP and WebSocket
 * traffic while retaining client HMR. Stopping either child stops the other.
 */

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsxCli = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const viteCli = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const entryPort = parsePort(process.env.PORT, 3080);
const entryHost = process.env.HOST?.trim() || '127.0.0.1';
const preferredServerPort = entryPort < 65_535 ? entryPort + 1 : entryPort - 1;
const internalServerPort = await findAvailableLoopbackPort(preferredServerPort);

if (process.env.VITE_HOST || process.env.VITE_PORT) {
  console.warn('[dev] VITE_HOST and VITE_PORT are deprecated; use HOST and PORT for the ConvoSketchpad entrypoint.');
}

const serverEnv = {
  ...process.env,
  HOST: '127.0.0.1',
  PORT: String(internalServerPort),
};
delete serverEnv.VITE_HOST;
delete serverEnv.VITE_PORT;

const clientEnv = {
  ...process.env,
  CONVOSKETCHPAD_DEV_ENTRY_HOST: entryHost,
  CONVOSKETCHPAD_DEV_ENTRY_PORT: String(entryPort),
  CONVOSKETCHPAD_DEV_SERVER_PORT: String(internalServerPort),
};
delete clientEnv.VITE_HOST;
delete clientEnv.VITE_PORT;

printDevEndpoints();

const children = [
  start('server', tsxCli, ['watch', 'server/index.ts'], serverEnv),
  start('client', viteCli, [], clientEnv),
];

let stopping = false;
let forceTimer;

function parsePort(value, fallback) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535) return parsed;
  return fallback;
}

function probeLoopbackPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(null));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      const address = server.address();
      const selected = typeof address === 'object' && address ? address.port : null;
      server.close(() => resolve(selected));
    });
  });
}

async function findAvailableLoopbackPort(preferredPort) {
  const preferred = await probeLoopbackPort(preferredPort);
  if (preferred) return preferred;
  const automatic = await probeLoopbackPort(0);
  if (automatic) return automatic;
  throw new Error('Could not allocate an internal loopback port for the development server.');
}

function printDevEndpoints() {
  const browserHost = entryHost === '0.0.0.0' || entryHost === '::'
    ? 'localhost'
    : entryHost.includes(':') && !entryHost.startsWith('[')
      ? `[${entryHost}]`
      : entryHost;
  console.log('');
  console.log('  ConvoSketchpad development');
  console.log(`  Open in browser:          http://${browserHost}:${entryPort}  [HOST / PORT]`);
  console.log(`  Server (automatic):       http://127.0.0.1:${internalServerPort}  [loopback only]`);
  console.log('  Proxy: /api, /health -> server');
  console.log('');
}

function start(name, entrypoint, args = [], env = process.env) {
  const child = spawn(process.execPath, [entrypoint, ...args], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  });

  child.once('error', (error) => {
    console.error(`[dev:${name}] Failed to start: ${error.message}`);
    shutdown('SIGTERM', 1);
  });

  child.once('exit', (code, signal) => {
    if (stopping) return;

    const reason = signal ? `signal ${signal}` : `exit code ${code ?? 1}`;
    console.error(`[dev:${name}] Process stopped (${reason}); stopping development environment.`);
    shutdown('SIGTERM', code ?? 1);
  });

  return child;
}

function signalChild(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;

  try {
    child.kill(signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      console.error(`[dev] Failed to stop child ${child.pid}: ${error.message}`);
    }
  }
}

function shutdown(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;

  for (const child of children) signalChild(child, signal);

  forceTimer = setTimeout(() => {
    for (const child of children) signalChild(child, 'SIGKILL');
    process.exit(exitCode);
  }, 6_000);
  forceTimer.unref();

  Promise.all(children.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('close', resolve);
  }))).then(() => {
    clearTimeout(forceTimer);
    process.exit(exitCode);
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
