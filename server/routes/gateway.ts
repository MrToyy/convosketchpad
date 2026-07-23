/** Restart the local OpenClaw gateway and verify that it becomes reachable. */
import { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { Socket } from 'node:net';
import { homedir } from 'node:os';
import { config } from '../lib/config.js';
import { resolveOpenclawBin } from '../lib/openclaw-bin.js';
import { rateLimitRestart } from '../middleware/rate-limit.js';

const app = new Hono();
const openclawBin = resolveOpenclawBin();
const nodeBinDir = process.execPath.replace(/\/node$/, '');
const GATEWAY_RESTART_TIMEOUT_MS = 15_000;

function inferOpenclawHome(): string {
  return openclawBin.match(/^(\/home\/[^/]+|\/Users\/[^/]+)/)?.[1]
    || process.env.HOME
    || homedir();
}

function runGatewayCommand(args: string[], env: NodeJS.ProcessEnv, timeout = 5_000) {
  return new Promise<{ ok: boolean; output: string }>((resolve) => {
    execFile(openclawBin, args, { timeout, maxBuffer: 512 * 1024, env }, (error, stdout, stderr) => {
      const output = (stdout + stderr).trim();
      resolve({ ok: !error, output: output || error?.message || '' });
    });
  });
}

function gatewayPortIsOpen(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const gatewayUrl = new URL(config.gatewayUrl);
    const port = Number.parseInt(gatewayUrl.port, 10) || 18789;
    socket.setTimeout(2_000);
    socket.connect(port, gatewayUrl.hostname, () => { socket.end(); resolve(true); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

app.post('/api/gateway/restart', rateLimitRestart, async (c) => {
  const uid = process.getuid?.() ?? 1000;
  const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
  const env = {
    ...process.env,
    HOME: inferOpenclawHome(),
    PATH: `${nodeBinDir}:${process.env.PATH || '/usr/bin:/bin'}`,
    XDG_RUNTIME_DIR: runtimeDir,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${runtimeDir}/bus`,
  };

  const restarted = await runGatewayCommand(['gateway', 'restart'], env, GATEWAY_RESTART_TIMEOUT_MS);
  if (!restarted.ok) return c.json(restarted, 500);

  await new Promise((resolve) => setTimeout(resolve, 2_000));
  let lastStatus = '';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1_000));
    const status = await runGatewayCommand(['gateway', 'status'], env);
    lastStatus = status.output;
    if (status.ok && status.output.includes('Runtime: running') && await gatewayPortIsOpen()) {
      return c.json({ ok: true, output: 'Gateway restarted successfully' });
    }
  }

  return c.json({ ok: false, output: `Gateway restarted but did not become ready.\n${lastStatus}`.trim() }, 500);
});

export default app;
