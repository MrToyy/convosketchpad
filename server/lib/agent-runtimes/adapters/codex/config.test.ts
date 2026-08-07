import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateCodexConfig } from './config.js';

describe('Codex Runtime configuration', () => {
  const originalCodeHome = process.env.CODEX_HOME;
  const originalWorkingDirectory = process.env.CODEX_WORKING_DIRECTORY;
  const directories: string[] = [];

  afterEach(() => {
    if (originalCodeHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodeHome;
    if (originalWorkingDirectory === undefined) delete process.env.CODEX_WORKING_DIRECTORY;
    else process.env.CODEX_WORKING_DIRECTORY = originalWorkingDirectory;
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it('accepts an existing project directory', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'codex-config-'));
    const codeHome = mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
    directories.push(root, codeHome);
    process.env.CODEX_HOME = codeHome;
    process.env.CODEX_WORKING_DIRECTORY = root;
    expect(validateCodexConfig().errors).toEqual([]);
  });

  it('rejects CODEX_HOME even through a symbolic link', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'codex-config-'));
    const codeHome = mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
    directories.push(root, codeHome);
    const alias = path.join(root, 'workspace');
    symlinkSync(codeHome, alias, 'dir');
    process.env.CODEX_HOME = codeHome;
    process.env.CODEX_WORKING_DIRECTORY = alias;
    expect(validateCodexConfig().errors).toContain('CODEX_WORKING_DIRECTORY must not be CODEX_HOME (~/.codex) or one of its subdirectories.');
  });
});
