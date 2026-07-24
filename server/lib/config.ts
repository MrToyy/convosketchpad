/** Runtime configuration for the Canvas server, Gateway bridge, and managed auth. */
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_GATEWAY_URL, DEFAULT_HOST, DEFAULT_PORT, DEFAULT_SSL_PORT } from './constants.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function findProjectRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const projectRoot = findProjectRoot(moduleDir) ?? findProjectRoot(process.cwd()) ?? path.resolve(process.cwd());
const homeDir = process.env.HOME || os.homedir();
const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: Number(process.env.PORT || DEFAULT_PORT),
  sslPort: Number(process.env.SSL_PORT || DEFAULT_SSL_PORT),
  host: process.env.HOST || DEFAULT_HOST,
  gatewayUrl: process.env.GATEWAY_URL || DEFAULT_GATEWAY_URL,
  gatewayToken: process.env.GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || '',
  gatewayTimezone: process.env.CONVOSKETCHPAD_GATEWAY_TIMEZONE?.trim() || localTimezone,
  publicOrigin: process.env.CONVOSKETCHPAD_PUBLIC_ORIGIN || '',
  home: homeDir,
  workspaceRoot: process.env.CONVOSKETCHPAD_WORKSPACE_ROOT || path.join(homeDir, '.openclaw', 'workspace'),
  sessionsDir: process.env.SESSIONS_DIR || path.join(homeDir, '.openclaw', 'agents', 'main', 'sessions'),
  usageFile: process.env.USAGE_FILE || path.join(homeDir, '.openclaw', 'token-usage.json'),
  agentLogPath: path.join(projectRoot, 'agent-log.json'),
  canvasDatabasePath: path.join(projectRoot, 'database', 'canvas.sqlite'),
  canvasArtifactsPath: path.join(projectRoot, 'artifacts'),
  certPath: path.join(projectRoot, 'certs', 'cert.pem'),
  keyPath: path.join(projectRoot, 'certs', 'key.pem'),
  limits: {
    agentLog: 64 * 1024,
    maxBodyBytes: 85 * 1024 * 1024,
  },
  agentLogMax: 200,
  auth: (process.env.CONVOSKETCHPAD_AUTH || 'false').toLowerCase() === 'true',
  sessionSecret: process.env.CONVOSKETCHPAD_SESSION_SECRET || '',
  sessionTtlMs: Number(process.env.CONVOSKETCHPAD_SESSION_TTL || 30 * 24 * 60 * 60 * 1000),
  authMaxFailures: Math.max(1, Math.floor(positiveNumber(process.env.CONVOSKETCHPAD_AUTH_MAX_FAILURES, 3))),
  authFailureWindowMs: positiveNumber(process.env.CONVOSKETCHPAD_AUTH_FAILURE_WINDOW, 30 * 60 * 1000),
  authLockoutMs: positiveNumber(process.env.CONVOSKETCHPAD_AUTH_LOCKOUT, 30 * 60 * 1000),
} as const;

export function updateConfig(key: 'sessionSecret', value: string): void {
  if (key !== 'sessionSecret' || !value) throw new Error('sessionSecret must be a non-empty string');
  (config as typeof config & { sessionSecret: string }).sessionSecret = value;
}

export const SESSION_COOKIE_NAME = `convosketchpad_session_${config.port}`;

export const WS_ALLOWED_HOSTS = new Set([
  'localhost', '127.0.0.1', '::1',
  ...(process.env.WS_ALLOWED_HOSTS?.split(',').map((host) => host.trim()).filter(Boolean) ?? []),
]);

export function printStartupBanner(version: string, tagline: string): void {
  console.log(`\n  \x1b[33m◆ ConvoSketchpad v${version}\x1b[0m`);
  console.log(`  ${tagline}`);
  console.log(`  Gateway: ${config.gatewayUrl}`);
  if (config.auth) console.log('  \x1b[32mAuthentication enabled\x1b[0m');
}

export async function probeGateway(): Promise<void> {
  try {
    const response = await fetch(`${config.gatewayUrl}/health`, { signal: AbortSignal.timeout(3_000) });
    if (response.ok) console.log('  \x1b[32mGateway reachable\x1b[0m');
    else console.warn(`  Gateway returned HTTP ${response.status}`);
  } catch {
    console.warn('  Gateway unreachable — is it running?');
  }
}

export function validateConfig(): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: config.gatewayTimezone }).format();
  } catch {
    console.error(
      `Invalid CONVOSKETCHPAD_GATEWAY_TIMEZONE: ${config.gatewayTimezone}. Expected an IANA timezone such as Asia/Shanghai.`,
    );
    process.exit(1);
  }
  if (!config.gatewayToken) {
    console.warn('GATEWAY_TOKEN is not set; Canvas Gateway calls will fail until it is configured.');
  }
  if (config.auth && !config.sessionSecret) {
    console.warn('CONVOSKETCHPAD_SESSION_SECRET is not set; generated sessions will not survive a restart.');
    updateConfig('sessionSecret', crypto.randomBytes(32).toString('hex'));
  }
  if (config.host === '0.0.0.0' && !config.auth && process.env.CONVOSKETCHPAD_ALLOW_INSECURE !== 'true') {
    console.error('Refusing to expose ConvoSketchpad on 0.0.0.0 without authentication.');
    process.exit(1);
  }
  if (config.host === '0.0.0.0' && !config.auth) {
    console.warn('ConvoSketchpad is network-accessible without managed authentication.');
  }
}
