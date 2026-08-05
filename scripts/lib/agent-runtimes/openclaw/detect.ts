/**
 * OpenClaw discovery and native configuration helpers.
 *
 * OpenClaw owns its configuration and device-pairing state. This module only
 * invokes supported `openclaw config` / `openclaw devices` commands; it never
 * opens or rewrites OpenClaw state files.
 */

import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { resolveOpenclawBin } from '../../../../server/lib/agent-runtimes/adapters/openclaw/setup-support.js';

export interface DetectedGateway {
  token: string | null;
  url: string | null;
}

export type GatewayTokenSource = 'existing' | 'detected' | 'env' | 'none';

export interface GatewayTokenChoice {
  token: string | null;
  source: GatewayTokenSource;
}

export interface NativeCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  notFound?: boolean;
}

export type NativeCommandOptions = Omit<SpawnSyncOptionsWithStringEncoding, 'encoding'> & {
  encoding?: BufferEncoding;
};

export type NativeCommandRunner = (
  command: string,
  args: string[],
  options?: NativeCommandOptions,
) => NativeCommandResult;

const runNativeCommand: NativeCommandRunner = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
    timeout: options.timeout ?? 15_000,
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
    notFound: result.error && 'code' in result.error && result.error.code === 'ENOENT',
  };
};

export interface OpenClawRuntimeDetection {
  detected: boolean;
  command: string;
  resolvedBinary: string | null;
  message: string;
}

function resolveCommandOnPath(command: string, pathValue = process.env.PATH || ''): string | null {
  const candidates = command.includes('/') || command.includes('\\')
    ? [isAbsolute(command) ? command : resolve(command)]
    : pathValue.split(delimiter).filter(Boolean).map((entry) => resolve(entry, command));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH in order.
    }
  }
  return null;
}

/**
 * Read the active local Gateway token and URL after OpenClaw has been selected
 * for configuration.
 *
 * `OPENCLAW_CONFIG_PATH` is inherited by the CLI, but this process never opens
 * the referenced file itself.
 */
export function detectGatewayConfig(
  runner: NativeCommandRunner = runNativeCommand,
  command = resolveOpenclawBin(),
  environment: NodeJS.ProcessEnv = process.env,
): DetectedGateway {
  const readValue = (key: string): unknown => {
    const result = runner(command, ['config', 'get', key, '--json'], {
      encoding: 'utf8',
      timeout: 10_000,
      env: environment,
    });
    if (result.status !== 0) return null;
    try { return JSON.parse(result.stdout.trim()); } catch { return null; }
  };
  const tokenValue = readValue('gateway.auth.token');
  const portValue = readValue('gateway.port');
  const token = typeof tokenValue === 'string' && tokenValue.trim() ? tokenValue.trim() : null;
  const port = typeof portValue === 'number' && Number.isInteger(portValue) && portValue > 0
    ? portValue
    : 18789;
  return { token, url: `http://127.0.0.1:${port}` };
}

/**
 * Detect the native CLI through the configured command or the current PATH.
 * A missing CLI does not mean a remote Gateway cannot be configured manually.
 */
export function detectOpenClawRuntime(input: {
  configuredBin?: string;
  environment?: NodeJS.ProcessEnv;
  runner?: NativeCommandRunner;
} = {}): OpenClawRuntimeDetection {
  const environment = input.environment || process.env;
  const runner = input.runner || runNativeCommand;
  const command = resolveOpenclawBin(input.configuredBin || environment.OPENCLAW_BIN);
  const probe = runner(command, ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
    env: environment,
  });
  if (probe.notFound) {
    return {
      detected: false,
      command,
      resolvedBinary: null,
      message: `${command} was not found on PATH`,
    };
  }

  const detected = probe.status !== null || !probe.notFound;
  return {
    detected,
    command,
    resolvedBinary: resolveCommandOnPath(command, environment.PATH),
    message: probe.status === 0
      ? 'OpenClaw CLI detected'
      : 'OpenClaw command found but its version could not be verified',
  };
}

export function getEnvGatewayToken(): string | null {
  return process.env.OPENCLAW_GATEWAY_TOKEN || null;
}

export function chooseSetupGatewayToken(opts: {
  existingToken?: string | null;
  detectedToken?: string | null;
  envToken?: string | null;
}): GatewayTokenChoice {
  const existingToken = opts.existingToken?.trim();
  if (existingToken) return { token: existingToken, source: 'existing' };
  const detectedToken = opts.detectedToken?.trim();
  if (detectedToken) return { token: detectedToken, source: 'detected' };
  const envToken = opts.envToken?.trim();
  if (envToken) return { token: envToken, source: 'env' };
  return { token: null, source: 'none' };
}
