import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyRuntimeEnv, validateLegacyRuntimeEnv } from './env-migration.js';

const cleanups: string[] = [];

function fixture(content: string): { root: string; envPath: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'convosketchpad-runtime-env-'));
  cleanups.push(root);
  const envPath = path.join(root, '.env');
  writeFileSync(envPath, content, 'utf8');
  return { root, envPath };
}

afterEach(() => {
  while (cleanups.length) rmSync(cleanups.pop()!, { recursive: true, force: true });
});

describe('Runtime environment migration', () => {
  it('atomically replaces the legacy key and preserves its value', () => {
    const { root, envPath } = fixture('# config\nAGENT_BACKENDS=openclaw\nPORT=3080\n');
    expect(migrateLegacyRuntimeEnv(root)).toBe(true);
    expect(readFileSync(envPath, 'utf8')).toBe('# config\nAGENT_RUNTIMES=openclaw\nPORT=3080\n');
    expect(migrateLegacyRuntimeEnv(root)).toBe(false);
  });

  it('removes the legacy duplicate when both keys agree', () => {
    const { root, envPath } = fixture('AGENT_BACKENDS=openclaw\nAGENT_RUNTIMES=openclaw\n');
    expect(migrateLegacyRuntimeEnv(root)).toBe(true);
    expect(readFileSync(envPath, 'utf8')).toBe('AGENT_RUNTIMES=openclaw\n');
  });

  it('leaves the file unchanged when old and new values conflict', () => {
    const original = 'AGENT_BACKENDS=openclaw\nAGENT_RUNTIMES=codex\n';
    const { root, envPath } = fixture(original);
    expect(() => validateLegacyRuntimeEnv(root)).toThrow('Conflicting AGENT_BACKENDS and AGENT_RUNTIMES');
    expect(() => migrateLegacyRuntimeEnv(root)).toThrow('Conflicting AGENT_BACKENDS and AGENT_RUNTIMES');
    expect(readFileSync(envPath, 'utf8')).toBe(original);
  });

  it('migrates every stable v0.3 OpenClaw key while preserving formatting', () => {
    const original = [
      '# OpenClaw',
      '  GATEWAY_URL = "http://127.0.0.1:18789"',
      'GATEWAY_TOKEN=secret-token',
      'CONVOSKETCHPAD_GATEWAY_TIMEZONE=Asia/Shanghai',
      '',
    ].join('\r\n');
    const { root, envPath } = fixture(original);

    expect(migrateLegacyRuntimeEnv(root)).toBe(true);
    expect(readFileSync(envPath, 'utf8')).toBe([
      '# OpenClaw',
      '  OPENCLAW_GATEWAY_URL = "http://127.0.0.1:18789"',
      'OPENCLAW_GATEWAY_TOKEN=secret-token',
      'OPENCLAW_GATEWAY_TIMEZONE=Asia/Shanghai',
      '',
    ].join('\r\n'));
  });

  it('removes matching stable-key duplicates without exposing values', () => {
    const { root, envPath } = fixture('GATEWAY_TOKEN="secret"\nOPENCLAW_GATEWAY_TOKEN=secret\n');
    expect(migrateLegacyRuntimeEnv(root)).toBe(true);
    expect(readFileSync(envPath, 'utf8')).toBe('OPENCLAW_GATEWAY_TOKEN=secret\n');
  });

  it('prevalidates every mapping and performs no partial write on conflict', () => {
    const original = 'AGENT_BACKENDS=openclaw\nGATEWAY_URL=one\nOPENCLAW_GATEWAY_URL=two\n';
    const { root, envPath } = fixture(original);
    expect(() => migrateLegacyRuntimeEnv(root)).toThrow('Conflicting GATEWAY_URL and OPENCLAW_GATEWAY_URL');
    expect(readFileSync(envPath, 'utf8')).toBe(original);
  });
});
