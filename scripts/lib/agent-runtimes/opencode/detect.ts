import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import net from 'node:net';
import { delimiter, isAbsolute, resolve } from 'node:path';
import {
  compareOpenCodeVersions,
  MINIMUM_OPENCODE_VERSION,
  parseOpenCodeVersion,
} from '../../../../server/lib/agent-runtimes/adapters/opencode/setup-support.js';

export interface OpenCodeRuntimeDetection {
  detected: boolean;
  command: string;
  resolvedBinary: string | null;
  version: string | null;
  supported: boolean;
  message: string;
}

function resolveCommandOnPath(command: string, pathValue = process.env.PATH || ''): string | null {
  const candidates = command.includes('/') || command.includes('\\')
    ? [isAbsolute(command) ? command : resolve(command)]
    : pathValue.split(delimiter).filter(Boolean).map((entry) => resolve(entry, command));
  for (const candidate of candidates) {
    try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* continue */ }
  }
  return null;
}

export function detectOpenCodeRuntime(input: {
  configuredBin?: string;
  environment?: NodeJS.ProcessEnv;
} = {}): OpenCodeRuntimeDetection {
  const environment = input.environment || process.env;
  const command = input.configuredBin || environment.OPENCODE_BIN || 'opencode';
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024, env: environment,
  });
  const notFound = result.error && 'code' in result.error && result.error.code === 'ENOENT';
  if (notFound) return {
    detected: false, command, resolvedBinary: null, version: null, supported: false,
    message: `${command} was not found on PATH`,
  };
  const version = parseOpenCodeVersion(`${result.stdout || ''}\n${result.stderr || ''}`);
  const supported = Boolean(version && compareOpenCodeVersions(version, MINIMUM_OPENCODE_VERSION) >= 0);
  return {
    detected: true,
    command,
    resolvedBinary: resolveCommandOnPath(command, environment.PATH),
    version,
    supported,
    message: version
      ? supported ? `OpenCode CLI ${version} detected` : `OpenCode CLI ${version} detected; ${MINIMUM_OPENCODE_VERSION} or newer is required`
      : 'OpenCode command found but its version could not be verified',
  };
}

async function availablePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePromise(port));
    });
  });
}

export async function probeOpenCodeServer(input: {
  binary: string;
  workingDirectory: string;
  timeoutMs?: number;
}): Promise<{ connected: boolean; message: string }> {
  const port = await availablePort();
  const username = `convosketchpad-setup-${randomBytes(6).toString('hex')}`;
  const password = randomBytes(24).toString('base64url');
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const child = spawn(input.binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port), '--log-level', 'ERROR'], {
    cwd: input.workingDirectory,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: {
      ...process.env,
      OPENCODE_SERVER_USERNAME: username,
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_DISABLE_AUTOUPDATE: 'true',
    },
  });
  child.stdout.resume();
  child.stderr.resume();
  const deadline = Date.now() + (input.timeoutMs || 12_000);
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) return { connected: false, message: `OpenCode Server exited (${child.exitCode})` };
      try {
        const response = await fetch(`http://127.0.0.1:${port}/global/health`, {
          headers: { authorization: auth },
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok) {
          const health = await response.json() as { healthy?: boolean; version?: string };
          if (health.healthy) {
            const providers = await fetch(
              `http://127.0.0.1:${port}/provider?directory=${encodeURIComponent(input.workingDirectory)}`,
              { headers: { authorization: auth }, signal: AbortSignal.timeout(2_000) },
            );
            if (!providers.ok) return { connected: false, message: `OpenCode Provider check returned ${providers.status}` };
            const catalog = await providers.json() as { connected?: string[]; default?: Record<string, string> };
            const hasDefault = (catalog.connected || []).some((providerId) => Boolean(catalog.default?.[providerId]));
            if (!hasDefault) return { connected: false, message: 'OpenCode has no connected Provider with a default model' };
            return { connected: true, message: `OpenCode Server ${health.version || ''} is ready`.trim() };
          }
        }
      } catch { /* retry until deadline */ }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    return { connected: false, message: 'OpenCode Server health check timed out' };
  } finally {
    if (!child.killed) child.kill('SIGTERM');
  }
}
