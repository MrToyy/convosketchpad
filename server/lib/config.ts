/** Runtime configuration for the Canvas server, Gateway bridge, and managed auth. */
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOST, DEFAULT_PORT } from './constants.js';
import { validateConfiguredAgentRuntimes } from './agent-runtimes/definitions.js';
import { configuredDefaultAgent } from './agent-runtimes/default-agent.js';
import {
  hasRemoteConfiguredOrigin,
  isLoopbackHostname,
  parseConfiguredOrigins,
} from './browser-origin-policy.js';

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
const DEPRECATED_ENV = [
  'CONVOSKETCHPAD_WORKSPACE_ROOT',
  'CONVOSKETCHPAD_UPLOAD_STAGING_TEMP_DIR',
  'SESSIONS_DIR',
  'USAGE_FILE',
  'CONVOSKETCHPAD_PUBLIC_ORIGIN',
  'WS_ALLOWED_HOSTS',
  'CSP_CONNECT_EXTRA',
  'SSL_PORT',
  'VITE_DISABLE_HTTPS',
  'VITE_HOST',
  'VITE_PORT',
] as const;

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  projectRoot,
  port: Number(process.env.PORT || DEFAULT_PORT),
  host: process.env.HOST || DEFAULT_HOST,
  canvasDatabasePath: path.join(projectRoot, 'database', 'canvas.sqlite'),
  canvasArtifactsPath: path.join(projectRoot, 'artifacts'),
  limits: {
    maxBodyBytes: 85 * 1024 * 1024,
  },
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

export function printStartupBanner(version: string, tagline: string): void {
  console.log(`\n  \x1b[33m◆ ConvoSketchpad v${version}\x1b[0m`);
  console.log(`  ${tagline}`);
  console.log(`  Agent Runtimes: ${process.env.AGENT_RUNTIMES || 'openclaw'}`);
  if (config.auth) console.log('  \x1b[32mAuthentication enabled\x1b[0m');
}

export function validateConfig(): void {
  for (const key of DEPRECATED_ENV) {
    if (process.env[key]) {
      console.warn(`${key} is deprecated and ignored by ConvoSketchpad runtime configuration.`);
    }
  }
  const runtimeValidation = validateConfiguredAgentRuntimes();
  runtimeValidation.warnings.forEach((warning) => console.warn(warning));
  if (runtimeValidation.errors.length > 0) {
    runtimeValidation.errors.forEach((error) => console.error(error));
    process.exit(1);
  }
  const defaultAgent = configuredDefaultAgent();
  if (defaultAgent.error) {
    console.error(defaultAgent.error);
    process.exit(1);
  }
  if (
    defaultAgent.ref
    && !(process.env.AGENT_RUNTIMES || 'openclaw')
      .split(',')
      .map((runtimeId) => runtimeId.trim().toLowerCase())
      .includes(defaultAgent.ref.runtimeId.toLowerCase())
  ) {
    console.error('The configured default Agent belongs to a Runtime that is not enabled by AGENT_RUNTIMES.');
    process.exit(1);
  }
  if (config.auth && !config.sessionSecret) {
    console.warn('CONVOSKETCHPAD_SESSION_SECRET is not set; generated sessions will not survive a restart.');
    updateConfig('sessionSecret', crypto.randomBytes(32).toString('hex'));
  }
  const configuredOrigins = parseConfiguredOrigins(process.env.ALLOWED_ORIGINS);
  if (configuredOrigins.invalid.length > 0) {
    console.error(`Invalid ALLOWED_ORIGINS value(s): ${configuredOrigins.invalid.join(', ')}`);
    process.exit(1);
  }
  const remoteOriginConfigured = hasRemoteConfiguredOrigin(configuredOrigins.origins);
  const networkExposed = !isLoopbackHostname(config.host);
  if ((networkExposed || remoteOriginConfigured) && !config.auth && process.env.CONVOSKETCHPAD_ALLOW_INSECURE !== 'true') {
    console.error('Refusing remote browser access without authentication.');
    process.exit(1);
  }
  if ((networkExposed || remoteOriginConfigured) && !config.auth) {
    console.warn('ConvoSketchpad is network-accessible without managed authentication.');
  }
}
