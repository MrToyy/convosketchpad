import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyAgentRuntimeEnv } from './env-migration.js';

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

describe('Agent Runtime environment migration', () => {
  it('atomically replaces the legacy key and preserves its value', () => {
    const { root, envPath } = fixture('# config\nAGENT_BACKENDS=openclaw\nPORT=3080\n');
    expect(migrateLegacyAgentRuntimeEnv(root)).toBe(true);
    expect(readFileSync(envPath, 'utf8')).toBe('# config\nAGENT_RUNTIMES=openclaw\nPORT=3080\n');
    expect(migrateLegacyAgentRuntimeEnv(root)).toBe(false);
  });

  it('removes the legacy duplicate when both keys agree', () => {
    const { root, envPath } = fixture('AGENT_BACKENDS=openclaw\nAGENT_RUNTIMES=openclaw\n');
    expect(migrateLegacyAgentRuntimeEnv(root)).toBe(true);
    expect(readFileSync(envPath, 'utf8')).toBe('AGENT_RUNTIMES=openclaw\n');
  });

  it('leaves the file unchanged when old and new values conflict', () => {
    const original = 'AGENT_BACKENDS=openclaw\nAGENT_RUNTIMES=codex\n';
    const { root, envPath } = fixture(original);
    expect(() => migrateLegacyAgentRuntimeEnv(root)).toThrow('Conflicting AGENT_BACKENDS and AGENT_RUNTIMES');
    expect(readFileSync(envPath, 'utf8')).toBe(original);
  });
});
