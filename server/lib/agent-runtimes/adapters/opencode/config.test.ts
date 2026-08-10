import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openCodeConfig, validateOpenCodeConfig } from './config.js';

describe('OpenCode Runtime configuration', () => {
  const original = process.env.OPENCODE_WORKING_DIRECTORY;
  const directories: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    if (original === undefined) delete process.env.OPENCODE_WORKING_DIRECTORY;
    else process.env.OPENCODE_WORKING_DIRECTORY = original;
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it('uses the existing fixed workspace and ignores the retired environment setting', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'opencode-config-home-'));
    directories.push(home);
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    const workspace = path.join(home, '.convosketchpad', 'workspace');
    mkdirSync(workspace, { recursive: true });
    process.env.OPENCODE_WORKING_DIRECTORY = '/ignored/custom/workspace';

    expect(openCodeConfig.workingDirectory).toBe(workspace);
    expect(validateOpenCodeConfig().errors).toEqual([]);
  });

  it('reports a missing fixed workspace', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'opencode-config-home-'));
    directories.push(home);
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    expect(validateOpenCodeConfig().errors[0]).toContain('Agent Runtime workspace is not an existing directory');
  });
});
