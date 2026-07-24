/**
 * OpenClaw discovery and native configuration helpers.
 *
 * OpenClaw owns its configuration and device-pairing state. This module only
 * reads legacy discovery inputs and invokes supported `openclaw config` /
 * `openclaw devices` commands; it never rewrites OpenClaw state files.
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { join } from 'node:path';
import os from 'node:os';

const HOME = process.env.HOME || os.homedir();
const DEFAULT_OPENCLAW_CONFIG = join(HOME, '.openclaw', 'openclaw.json');
const SAFE_DEVICE_REQUEST_ID_RE = /^[A-Za-z0-9_-]+$/;
const REQUIRED_OPERATOR_SCOPES = ['operator.read', 'operator.write'] as const;

function resolveOpenClawConfigPath(): string {
  return process.env.OPENCLAW_CONFIG_PATH?.trim() || DEFAULT_OPENCLAW_CONFIG;
}

function resolveOpenClawBin(): string {
  return process.env.OPENCLAW_BIN?.trim() || 'openclaw';
}

interface OpenClawConfig {
  gateway?: {
    port?: number;
    auth?: {
      token?: string;
    };
  };
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
 * This remains read-only discovery. All mutations in this module go through
 * the OpenClaw CLI.
 */
export function detectGatewayConfig(): DetectedGateway {
  const result: DetectedGateway = { token: readSystemdGatewayToken(), url: null };
  const openclawConfigPath = resolveOpenClawConfigPath();
  if (!existsSync(openclawConfigPath)) return result;

  try {
    const config = JSON.parse(readFileSync(openclawConfigPath, 'utf8')) as OpenClawConfig;
    if (!result.token && config.gateway?.auth?.token) result.token = config.gateway.auth.token;
    result.url = `http://127.0.0.1:${config.gateway?.port || 18789}`;
  } catch {
    // Keep any service token already discovered.
  }
  return result;
}

function readSystemdGatewayToken(): string | null {
  const servicePaths = [
    join(HOME, '.config', 'systemd', 'user', 'openclaw-gateway.service'),
    '/etc/systemd/system/openclaw-gateway.service',
  ];
  for (const servicePath of servicePaths) {
    if (!existsSync(servicePath)) continue;
    try {
      const match = readFileSync(servicePath, 'utf8').match(/OPENCLAW_GATEWAY_TOKEN=(\S+)/);
      if (match?.[1]) return match[1];
    } catch {
      // Try the next supported service path.
    }
  }
  return null;
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

export interface NativeOpenClawCapabilities {
  configPatch: boolean;
  devicesList: boolean;
  devicesApprove: boolean;
}

export function detectNativeOpenClawCapabilities(
  runner: NativeCommandRunner = runNativeCommand,
): NativeOpenClawCapabilities {
  const command = resolveOpenClawBin();
  const supports = (args: string[], marker: string): boolean => {
    const result = runner(command, args, { encoding: 'utf8', timeout: 10_000 });
    return result.status === 0 && `${result.stdout}\n${result.stderr}`.includes(marker);
  };
  return {
    configPatch: supports(['config', 'patch', '--help'], '--dry-run'),
    devicesList: supports(['devices', 'list', '--help'], '--json'),
    devicesApprove: supports(['devices', 'approve', '--help'], 'requestId'),
  };
}

function normalizeOrigin(origin: string): string | null {
  try {
    const normalized = new URL(origin.trim()).origin;
    return normalized === 'null' ? null : normalized;
  } catch {
    return null;
  }
}

function parseOriginList(raw: string): string[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every(value => typeof value === 'string')
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export interface GatewayOriginUpdateResult {
  ok: boolean;
  changed: boolean;
  origins: string[];
  message: string;
}

export function ensureGatewayAllowedOrigins(
  requestedOrigins: string[],
  runner: NativeCommandRunner = runNativeCommand,
): GatewayOriginUpdateResult {
  const requested = [...new Set(
    requestedOrigins
      .map(normalizeOrigin)
      .filter((origin): origin is string => Boolean(origin)),
  )];
  if (requested.length === 0) {
    return { ok: true, changed: false, origins: [], message: 'No Gateway origins required' };
  }

  const command = resolveOpenClawBin();
  const currentResult = runner(
    command,
    ['config', 'get', 'gateway.controlUi.allowedOrigins', '--json'],
    { encoding: 'utf8', timeout: 10_000 },
  );
  const missingPath = `${currentResult.stdout}\n${currentResult.stderr}`.includes('Config path not found');
  const current = currentResult.status === 0
    ? parseOriginList(currentResult.stdout)
    : missingPath ? [] : null;
  if (!current) {
    return {
      ok: false,
      changed: false,
      origins: [],
      message: `Could not read Gateway allowed origins: ${currentResult.stderr || currentResult.stdout}`.trim(),
    };
  }

  const merged = [...current];
  const normalizedCurrent = new Set(current.map(normalizeOrigin).filter(Boolean));
  for (const origin of requested) {
    if (!normalizedCurrent.has(origin)) {
      merged.push(origin);
      normalizedCurrent.add(origin);
    }
  }
  if (merged.length === current.length) {
    return {
      ok: true,
      changed: false,
      origins: current,
      message: 'Gateway allowed origins already include the required values',
    };
  }

  const patch = JSON.stringify({ gateway: { controlUi: { allowedOrigins: merged } } });
  const patchArgs = [
    'config',
    'patch',
    '--stdin',
    '--replace-path',
    'gateway.controlUi.allowedOrigins',
  ];
  const dryRun = runner(command, [...patchArgs, '--dry-run', '--json'], {
    encoding: 'utf8',
    input: patch,
    timeout: 20_000,
  });
  if (dryRun.status !== 0) {
    return {
      ok: false,
      changed: false,
      origins: current,
      message: `OpenClaw rejected the origin update: ${dryRun.stderr || dryRun.stdout}`.trim(),
    };
  }

  const applied = runner(command, patchArgs, {
    encoding: 'utf8',
    input: patch,
    timeout: 20_000,
  });
  if (applied.status !== 0) {
    return {
      ok: false,
      changed: false,
      origins: current,
      message: `Failed to update Gateway allowed origins: ${applied.stderr || applied.stdout}`.trim(),
    };
  }

  return {
    ok: true,
    changed: true,
    origins: merged,
    message: `Added ${merged.length - current.length} Gateway allowed origin(s) with OpenClaw config`,
  };
}

interface DeviceIdentityMatch {
  deviceId?: string;
  publicKey?: string;
}

interface PendingDeviceRequest {
  requestId?: string;
  deviceId?: string;
  publicKey?: string;
}

function readNerveDeviceIdentity(): DeviceIdentityMatch | null {
  const nerveDir = process.env.NERVE_DATA_DIR || join(process.env.HOME || HOME, '.nerve');
  const identityPath = join(nerveDir, 'device-identity.json');
  if (!existsSync(identityPath)) return null;
  try {
    const stored = JSON.parse(readFileSync(identityPath, 'utf8')) as {
      deviceId?: string;
      publicKeyB64url?: string;
    };
    const deviceId = stored.deviceId?.trim();
    const publicKey = stored.publicKeyB64url?.trim();
    return deviceId || publicKey ? { deviceId, publicKey } : null;
  } catch {
    return null;
  }
}

function matchesPendingDeviceRequest(
  item: PendingDeviceRequest,
  identity: DeviceIdentityMatch,
): boolean {
  const requestDeviceId = item.deviceId?.trim();
  const requestPublicKey = item.publicKey?.trim();
  if (identity.deviceId && identity.publicKey) {
    return requestDeviceId === identity.deviceId && requestPublicKey === identity.publicKey;
  }
  if (identity.deviceId) return requestDeviceId === identity.deviceId;
  return Boolean(identity.publicKey && requestPublicKey === identity.publicKey);
}

function gatewayWsUrl(gatewayUrl: string): string {
  const url = new URL(gatewayUrl);
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  if (!url.pathname || url.pathname === '/') url.pathname = '/ws';
  return url.toString();
}

export interface DeviceApprovalResult {
  ok: boolean;
  approved: number;
  requestId?: string;
  message: string;
}

export function approvePendingNerveDevice(opts: {
  gatewayUrl?: string;
  gatewayToken?: string;
  runner?: NativeCommandRunner;
} = {}): DeviceApprovalResult {
  const runner = opts.runner || runNativeCommand;
  const identity = readNerveDeviceIdentity();
  if (!identity) {
    return {
      ok: false,
      approved: 0,
      message: 'Could not identify the ConvoSketchpad device; use `openclaw devices list` on the Gateway host',
    };
  }

  const connectionArgs = opts.gatewayUrl
    ? ['--url', gatewayWsUrl(opts.gatewayUrl), ...(opts.gatewayToken ? ['--token', opts.gatewayToken] : [])]
    : [];
  const command = resolveOpenClawBin();
  const listed = runner(command, ['devices', 'list', '--json', ...connectionArgs], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (listed.status !== 0) {
    return {
      ok: false,
      approved: 0,
      message: 'Could not inspect pending devices; approve the ConvoSketchpad request on the Gateway host',
    };
  }

  let pendingItems: PendingDeviceRequest[];
  try {
    const parsed = JSON.parse(listed.stdout) as { pending?: unknown };
    if (!Array.isArray(parsed.pending)) throw new Error('invalid pending shape');
    pendingItems = parsed.pending as PendingDeviceRequest[];
  } catch {
    return {
      ok: false,
      approved: 0,
      message: 'OpenClaw returned an unusable pending-device response',
    };
  }

  const matches = pendingItems.filter(item =>
    typeof item.requestId === 'string'
    && SAFE_DEVICE_REQUEST_ID_RE.test(item.requestId)
    && matchesPendingDeviceRequest(item, identity));
  if (matches.length !== 1) {
    return {
      ok: matches.length === 0 && pendingItems.length === 0,
      approved: 0,
      message: matches.length === 0
        ? 'No unambiguous ConvoSketchpad pairing request was found'
        : 'Multiple ConvoSketchpad pairing requests matched; approve one manually',
    };
  }

  const requestId = matches[0].requestId!;
  const approved = runner(
    command,
    ['devices', 'approve', requestId, ...connectionArgs],
    { encoding: 'utf8', timeout: 10_000 },
  );
  if (approved.status !== 0) {
    return {
      ok: false,
      approved: 0,
      requestId,
      message: `OpenClaw could not approve ${requestId}; approve it on the Gateway host`,
    };
  }
  return {
    ok: true,
    approved: 1,
    requestId,
    message: `Approved ConvoSketchpad device request ${requestId}`,
  };
}

export interface ConfigChange {
  id: string;
  description: string;
  apply: () => { ok: boolean; message: string; needsRestart: boolean };
}

export function detectNeededConfigChanges(opts: {
  nerveOrigin?: string;
  nerveHttpsOrigin?: string;
  allowedOrigins?: string[];
}): ConfigChange[] {
  const origins = [...new Set([
    ...(opts.allowedOrigins || []),
    opts.nerveOrigin,
    opts.nerveHttpsOrigin,
  ].map(origin => origin?.trim()).filter((origin): origin is string => Boolean(origin)))];
  if (origins.length === 0) return [];

  return [{
    id: 'allowed-origins',
    description: `Add ${origins.join(', ')} to the Gateway allowed origins`,
    apply: () => {
      const result = ensureGatewayAllowedOrigins(origins);
      return { ok: result.ok, message: result.message, needsRestart: false };
    },
  }];
}

export function requiredOperatorScopes(): string[] {
  return [...REQUIRED_OPERATOR_SCOPES];
}
