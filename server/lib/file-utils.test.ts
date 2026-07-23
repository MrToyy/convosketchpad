import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('Canvas attachment file utilities', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    vi.resetModules();
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-file-utils-'));
    vi.doMock('./config.js', () => ({ config: { workspaceRoot } }));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('always blocks sensitive and generated path segments', async () => {
    const { isExcluded } = await import('./file-utils.js');
    expect(isExcluded('node_modules')).toBe(true);
    expect(isExcluded('.git')).toBe(true);
    expect(isExcluded('.env.local')).toBe(true);
    expect(isExcluded('src')).toBe(false);
  });

  it('uses the configured Canvas workspace unless an agent workspace is explicit', async () => {
    const { getWorkspaceRoot } = await import('./file-utils.js');
    expect(getWorkspaceRoot()).toBe(path.resolve(workspaceRoot));
    expect(getWorkspaceRoot('/managed/designer')).toBe(path.resolve('/managed/designer'));
  });

  it('resolves existing and prospective files inside the workspace', async () => {
    const { resolveWorkspacePath } = await import('./file-utils.js');
    await fs.writeFile(path.join(workspaceRoot, 'source.png'), 'image');
    expect(await resolveWorkspacePath('source.png')).toBe(path.join(workspaceRoot, 'source.png'));
    expect(await resolveWorkspacePath('exports/new.png', { allowNonExistent: true })).toBe(path.join(workspaceRoot, 'exports/new.png'));
  });

  it('rejects traversal, excluded directories, and escaping symlinks', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-file-outside-'));
    try {
      await fs.symlink(outside, path.join(workspaceRoot, 'outside'));
      const { resolveWorkspacePath } = await import('./file-utils.js');
      expect(await resolveWorkspacePath('../secret.png', { allowNonExistent: true })).toBeNull();
      expect(await resolveWorkspacePath('.git/config')).toBeNull();
      expect(await resolveWorkspacePath('outside/secret.png', { allowNonExistent: true })).toBeNull();
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

});
