/**
 * Starts the Vite client and watch-mode server behind one browser-facing port.
 *
 * The server keeps its own internal port so Vite can proxy HTTP and WebSocket
 * traffic while retaining client HMR. Stopping either child stops the other.
 */

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsxCli = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const viteCli = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const frontendPort = parsePort(process.env.VITE_PORT, 3080);
const configuredBackendPort = parsePort(process.env.PORT);
const fallbackBackendPort = frontendPort < 65_535 ? frontendPort + 1 : frontendPort - 1;
const backendPort = configuredBackendPort && configuredBackendPort !== frontendPort
  ? configuredBackendPort
  : fallbackBackendPort;
const childEnv = {
  ...process.env,
  PORT: String(backendPort),
};

printDevEndpoints();

const children = [
  start('server', tsxCli, ['watch', 'server/index.ts']),
  start('client', viteCli),
];

let stopping = false;
let forceTimer;

function parsePort(value, fallback) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535) return parsed;
  return fallback;
}

function printDevEndpoints() {
  const configuredHost = process.env.VITE_HOST?.trim() || '127.0.0.1';
  const browserHost = configuredHost === '0.0.0.0' || configuredHost === '::'
    ? 'localhost'
    : configuredHost.includes(':') && !configuredHost.startsWith('[')
      ? `[${configuredHost}]`
      : configuredHost;
  const certsExist = existsSync(path.join(projectRoot, 'certs', 'cert.pem'))
    && existsSync(path.join(projectRoot, 'certs', 'key.pem'));
  const protocol = process.env.VITE_DISABLE_HTTPS !== 'true' && certsExist ? 'https' : 'http';

  console.log('');
  console.log('  ConvoSketchpad development');
  console.log(`  Frontend (open in browser): ${protocol}://${browserHost}:${frontendPort}  [VITE_PORT]`);
  console.log(`  Backend  (internal only):   http://localhost:${backendPort}  [PORT]`);
  console.log('  Proxy: /api, /health, /ws -> backend');
  if (configuredBackendPort === frontendPort) {
    console.log(`  Note: PORT matched VITE_PORT, so the internal backend was moved to ${backendPort}.`);
  }
  console.log('');
}

function start(name, entrypoint, args = []) {
  const child = spawn(process.execPath, [entrypoint, ...args], {
    cwd: projectRoot,
    env: childEnv,
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
