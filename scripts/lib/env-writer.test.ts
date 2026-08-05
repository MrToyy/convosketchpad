import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  generateEnvContent,
  loadExistingEnv,
  restoreEnvAfterFailedSetup,
  type EnvConfig,
} from './env-writer.js';

describe('ConvoSketchpad env writer', () => {
  it('writes every supported branded runtime setting', () => {
    const content = generateEnvContent({
      AGENT_RUNTIMES: 'openclaw',
      CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME: 'openclaw',
      CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE: 'main',
      OPENCLAW_GATEWAY_TOKEN: 'gateway-token',
      OPENCLAW_GATEWAY_TIMEZONE: 'Asia/Shanghai',
      CONVOSKETCHPAD_DATA_DIR: '/srv/convosketchpad',
      CONVOSKETCHPAD_AUTH: 'true',
      CONVOSKETCHPAD_SESSION_SECRET: 'session-secret',
      CONVOSKETCHPAD_SESSION_TTL: '86400000',
      CONVOSKETCHPAD_AUTH_MAX_FAILURES: '5',
      CONVOSKETCHPAD_AUTH_FAILURE_WINDOW: '600000',
      CONVOSKETCHPAD_AUTH_LOCKOUT: '900000',
      CONVOSKETCHPAD_ALLOW_INSECURE: 'false',
    });

    expect(content).toContain('# ConvoSketchpad Configuration');
    expect(content).toContain('AGENT_RUNTIMES=openclaw');
    expect(content).toContain('CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME=openclaw');
    expect(content).toContain('CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE=main');
    expect(content).toContain('OPENCLAW_GATEWAY_TIMEZONE=Asia/Shanghai');
    expect(content).not.toContain('CONVOSKETCHPAD_PUBLIC_ORIGIN');
    expect(content).not.toContain('WS_ALLOWED_HOSTS');
    expect(content).not.toContain('CSP_CONNECT_EXTRA');
    expect(content).not.toContain('SSL_PORT');
    expect(content).not.toContain('VITE_DISABLE_HTTPS');
    expect(content).not.toContain('VITE_HOST');
    expect(content).not.toContain('VITE_PORT');
    expect(content).not.toContain('CONVOSKETCHPAD_WORKSPACE_ROOT');
    expect(content).not.toContain('CONVOSKETCHPAD_UPLOAD_STAGING_TEMP_DIR');
    expect(content).not.toContain('SESSIONS_DIR');
    expect(content).not.toContain('USAGE_FILE');
    expect(content).toContain('CONVOSKETCHPAD_DATA_DIR=/srv/convosketchpad');
    expect(content).toContain('CONVOSKETCHPAD_AUTH=true');
    expect(content).toContain('CONVOSKETCHPAD_SESSION_SECRET=session-secret');
    expect(content).toContain('CONVOSKETCHPAD_SESSION_TTL=86400000');
    expect(content).toContain('CONVOSKETCHPAD_AUTH_MAX_FAILURES=5');
    expect(content).toContain('CONVOSKETCHPAD_AUTH_FAILURE_WINDOW=600000');
    expect(content).toContain('CONVOSKETCHPAD_AUTH_LOCKOUT=900000');
    expect(content).toContain('CONVOSKETCHPAD_ALLOW_INSECURE=false');
    expect(content).not.toContain('NERVE_');
  });

  it('does not write a partial default Agent reference', () => {
    const content = generateEnvContent({
      OPENCLAW_GATEWAY_TOKEN: 'gateway-token',
      CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME: 'openclaw',
    });
    expect(content).not.toContain('CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME');
    expect(content).not.toContain('CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE');
  });

  it('only writes configuration for selected Agent Runtimes', () => {
    const content = generateEnvContent({
      AGENT_RUNTIMES: 'codex',
      OPENCLAW_GATEWAY_URL: 'https://gateway.example.com',
      OPENCLAW_GATEWAY_TOKEN: 'stale-openclaw-token',
      OPENCLAW_GATEWAY_TIMEZONE: 'Asia/Shanghai',
      OPENCLAW_BIN: '/usr/local/bin/openclaw',
    });

    expect(content).toContain('AGENT_RUNTIMES=codex');
    expect(content).not.toContain('# OpenClaw Gateway');
    expect(content).not.toContain('OPENCLAW_');
    expect(content).not.toContain('stale-openclaw-token');
  });

  it('drops legacy Vite listener settings from regenerated env files', () => {
    const legacyConfig = {
      OPENCLAW_GATEWAY_TOKEN: 'gateway-token',
      PORT: '3080',
      HOST: '127.0.0.1',
      VITE_HOST: '0.0.0.0',
      VITE_PORT: '4000',
    } as unknown as EnvConfig;

    const content = generateEnvContent(legacyConfig);
    expect(content).toContain('PORT=3080');
    expect(content).not.toContain('VITE_HOST');
    expect(content).not.toContain('VITE_PORT');
  });

  it('loads the development-only Backend key as the current Runtime key', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-env-writer-'));
    const envPath = path.join(dir, '.env');
    writeFileSync(envPath, 'AGENT_BACKENDS=openclaw\nOPENCLAW_GATEWAY_TOKEN=token\n', 'utf8');
    try {
      expect(loadExistingEnv(envPath)).toMatchObject({
        AGENT_RUNTIMES: 'openclaw',
        OPENCLAW_GATEWAY_TOKEN: 'token',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves an explicitly empty Runtime selection for validation to reject', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-env-writer-'));
    const envPath = path.join(dir, '.env');
    writeFileSync(envPath, 'AGENT_RUNTIMES=\nOPENCLAW_GATEWAY_TOKEN=token\n', 'utf8');
    try {
      expect(loadExistingEnv(envPath)).toMatchObject({
        AGENT_RUNTIMES: '',
        OPENCLAW_GATEWAY_TOKEN: 'token',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not let a legacy Runtime key overwrite an explicitly empty current key', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-env-writer-'));
    const envPath = path.join(dir, '.env');
    writeFileSync(envPath, 'AGENT_BACKENDS=openclaw\nAGENT_RUNTIMES=\n', 'utf8');
    try {
      expect(() => loadExistingEnv(envPath)).toThrow('Conflicting AGENT_BACKENDS and AGENT_RUNTIMES');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('restores an existing environment after setup fails', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-env-restore-'));
    const envPath = path.join(dir, '.env');
    const backupPath = path.join(dir, '.env.backup');
    try {
      writeFileSync(envPath, 'PORT=4000\n');
      writeFileSync(backupPath, 'PORT=3080\n');
      restoreEnvAfterFailedSetup(envPath, backupPath);
      expect(loadExistingEnv(envPath).PORT).toBe('3080');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes a newly-created environment after setup fails', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-env-restore-'));
    const envPath = path.join(dir, '.env');
    try {
      writeFileSync(envPath, 'PORT=3080\n');
      restoreEnvAfterFailedSetup(envPath);
      expect(() => loadExistingEnv(envPath)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
