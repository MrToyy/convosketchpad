/**
 * OpenClaw discovery and native configuration helpers.
 *
 * OpenClaw owns its configuration and device-pairing state. This module only
 * invokes supported `openclaw config` / `openclaw devices` commands; it never
 * opens or rewrites OpenClaw state files.
 */

import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';

function resolveOpenClawBin(): string {
  return process.env.OPENCLAW_BIN?.trim() || 'openclaw';
}

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
  };
};

/**
 * Read the active local Gateway token and URL for setup defaults.
 *
 * `OPENCLAW_CONFIG_PATH` is inherited by the CLI, but this process never opens
 * the referenced file itself.
 */
export function detectGatewayConfig(
  runner: NativeCommandRunner = runNativeCommand,
): DetectedGateway {
  const command = resolveOpenClawBin();
  const readValue = (key: string): unknown => {
    const result = runner(command, ['config', 'get', key, '--json'], {
      encoding: 'utf8',
      timeout: 10_000,
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
