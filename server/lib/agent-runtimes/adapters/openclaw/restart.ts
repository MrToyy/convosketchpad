import { execFile } from 'node:child_process';
import { Socket } from 'node:net';
import { homedir } from 'node:os';
import { openClawConfig } from './config.js';
import { resolveOpenclawBin } from './binary.js';
import { RuntimeOperationError } from '../../contract.js';

const openclawBin = resolveOpenclawBin();
const nodeBinDir = process.execPath.replace(/\/node$/, '');
const GATEWAY_RESTART_TIMEOUT_MS = 15_000;

export function gatewayIsLocal(gatewayUrl: string): boolean {
  try {
    const hostname = new URL(gatewayUrl).hostname.toLowerCase();
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  } catch {
    return false;
  }
}

function inferOpenclawHome(): string {
  return openclawBin.match(/^(\/home\/[^/]+|\/Users\/[^/]+)/)?.[1]
    || process.env.HOME
    || homedir();
}

function runGatewayCommand(
  args: string[],
  environment: NodeJS.ProcessEnv,
  timeout = 5_000,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(openclawBin, args, {
      timeout,
      maxBuffer: 512 * 1024,
      env: environment,
    }, (error, stdout, stderr) => {
      const output = (stdout + stderr).trim();
      resolve({ ok: !error, output: output || error?.message || '' });
    });
  });
}

function gatewayPortIsOpen(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const gatewayUrl = new URL(openClawConfig.gatewayUrl);
    const port = Number.parseInt(gatewayUrl.port, 10) || 18789;
    socket.setTimeout(2_000);
    socket.connect(port, gatewayUrl.hostname, () => { socket.end(); resolve(true); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

export async function restartOpenClawGateway(): Promise<{ output: string }> {
  if (!gatewayIsLocal(openClawConfig.gatewayUrl)) {
    throw new RuntimeOperationError(
      'unsupported',
      'Restart the OpenClaw Gateway on its host; remote Gateway restart is not supported.',
    );
  }
  const uid = process.getuid?.() ?? 1000;
  const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
  const environment = {
    ...process.env,
    HOME: inferOpenclawHome(),
    PATH: `${nodeBinDir}:${process.env.PATH || '/usr/bin:/bin'}`,
    XDG_RUNTIME_DIR: runtimeDir,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${runtimeDir}/bus`,
  };

  const restarted = await runGatewayCommand(
    ['gateway', 'restart'],
    environment,
    GATEWAY_RESTART_TIMEOUT_MS,
  );
  if (!restarted.ok) {
    throw new RuntimeOperationError('internal', restarted.output || 'Gateway restart failed');
  }

  await new Promise((resolve) => setTimeout(resolve, 2_000));
  let lastStatus = '';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1_000));
    const status = await runGatewayCommand(['gateway', 'status'], environment);
    lastStatus = status.output;
    if (status.ok && status.output.includes('Runtime: running') && await gatewayPortIsOpen()) {
      return { output: 'Gateway restarted successfully' };
    }
  }
  throw new RuntimeOperationError(
    'unavailable',
    `Gateway restarted but did not become ready.\n${lastStatus}`.trim(),
  );
}
