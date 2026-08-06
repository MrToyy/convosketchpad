import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CODEX_WORKING_DIRECTORY,
  codexWorkingDirectoryPromptDefault,
  ensureCodexWorkingDirectory,
  normalizeCodexWorkingDirectory,
} from './setup-driver.js';

describe('Codex setup working directory', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it('uses the documented default for a new setup and the .env value for an update', () => {
    expect(codexWorkingDirectoryPromptDefault()).toBe('~/codex-convosketchpad');
    expect(DEFAULT_CODEX_WORKING_DIRECTORY).toBe('~/codex-convosketchpad');
    expect(codexWorkingDirectoryPromptDefault('/srv/existing-workspace')).toBe('/srv/existing-workspace');
  });

  it('expands a home-relative default to an absolute directory', () => {
    expect(normalizeCodexWorkingDirectory('~/codex-convosketchpad'))
      .toBe(path.join(os.homedir(), 'codex-convosketchpad'));
  });

  it('creates a selected directory when it does not exist', () => {
    const parent = mkdtempSync(path.join(os.tmpdir(), 'codex-setup-directory-'));
    directories.push(parent);
    const selected = path.join(parent, 'workspace');

    expect(ensureCodexWorkingDirectory(selected)).toBe(selected);
    expect(existsSync(selected)).toBe(true);
  });
});
