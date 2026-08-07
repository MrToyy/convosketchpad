import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveUpdaterStatePaths } from './state-paths.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  vi.unstubAllEnvs();
  while (cleanups.length) cleanups.pop()?.();
});

describe('updater state paths', () => {
  it('reads a project-relative data directory from .env', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'convosketchpad-state-'));
    cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
    writeFileSync(join(cwd, '.env'), 'CONVOSKETCHPAD_DATA_DIR=.state\n');

    expect(resolveUpdaterStatePaths(cwd).stateDir).toBe(resolve(cwd, '.state/updater'));
  });

  it('gives an explicit process override precedence over .env', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'convosketchpad-state-'));
    cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
    writeFileSync(join(cwd, '.env'), 'CONVOSKETCHPAD_DATA_DIR=.state\n');
    vi.stubEnv('CONVOSKETCHPAD_DATA_DIR', join(cwd, 'override'));

    expect(resolveUpdaterStatePaths(cwd).dataDir).toBe(join(cwd, 'override'));
  });
});
