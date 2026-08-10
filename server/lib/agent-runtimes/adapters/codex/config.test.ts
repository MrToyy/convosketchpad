import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codexConfig, validateCodexConfig } from './config.js';

describe('Codex Runtime configuration', () => {
  const originalCodeHome = process.env.CODEX_HOME;
  const originalWorkingDirectory = process.env.CODEX_WORKING_DIRECTORY;
  const directories: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalCodeHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodeHome;
    if (originalWorkingDirectory === undefined) delete process.env.CODEX_WORKING_DIRECTORY;
    else process.env.CODEX_WORKING_DIRECTORY = originalWorkingDirectory;
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it('uses the existing fixed workspace and ignores the retired environment setting', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'codex-config-home-'));
    directories.push(home);
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    const workspace = path.join(home, '.convosketchpad', 'workspace');
    mkdirSync(workspace, { recursive: true });
    process.env.CODEX_WORKING_DIRECTORY = '/ignored/custom/workspace';

    expect(codexConfig.workingDirectory).toBe(workspace);
    expect(validateCodexConfig().errors).toEqual([]);
  });

  it('rejects a symbolic-link workspace', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'codex-config-home-'));
    const codeHome = mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
    directories.push(home, codeHome);
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    process.env.CODEX_HOME = codeHome;
    const workspace = path.join(home, '.convosketchpad', 'workspace');
    mkdirSync(path.dirname(workspace), { recursive: true });
    symlinkSync(codeHome, workspace, 'dir');

    expect(validateCodexConfig().errors).toContain(
      `Agent Runtime workspace is not a regular directory: ${workspace}`,
    );
  });

  it('reports a missing fixed workspace', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'codex-config-home-'));
    directories.push(home);
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    expect(validateCodexConfig().errors[0]).toContain('Agent Runtime workspace is not an existing directory');
  });
});
