import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectOpenCodeTurnArtifacts,
  materializeOpenCodeManagedArtifact,
  prepareOpenCodeArtifactDirectory,
  releaseOpenCodeManagedArtifact,
} from './artifacts.js';

describe('OpenCode managed Artifacts', () => {
  let workspace = '';
  let temporaryHome = '';
  beforeEach(async () => {
    temporaryHome = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-artifacts-'));
    vi.spyOn(os, 'homedir').mockReturnValue(temporaryHome);
    workspace = path.join(temporaryHome, '.convosketchpad', 'workspace');
    await fs.mkdir(workspace, { recursive: true });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(temporaryHome, { recursive: true, force: true });
  });

  it('collects, materializes, and releases only the managed output file', async () => {
    const prepared = await prepareOpenCodeArtifactDirectory('reservation-artifact');
    await fs.writeFile(path.join(prepared.outputDirectory, 'report.txt'), 'hello');
    const collected = await collectOpenCodeTurnArtifacts(prepared.token, false);
    expect(collected.artifacts).toHaveLength(1);
    const handle = collected.artifacts[0]?.runtimeArtifactRef;
    if (!handle) throw new Error('missing handle');
    const materialized = await materializeOpenCodeManagedArtifact(handle);
    expect(Buffer.from(materialized.bytes || []).toString()).toBe('hello');
    await releaseOpenCodeManagedArtifact(handle);
    await expect(fs.access(path.join(prepared.outputDirectory, 'report.txt'))).rejects.toThrow();
  });

  it('rejects symbolic links from the output directory', async () => {
    const prepared = await prepareOpenCodeArtifactDirectory('reservation-link');
    const outside = path.join(workspace, 'outside.txt');
    await fs.writeFile(outside, 'secret');
    await fs.symlink(outside, path.join(prepared.outputDirectory, 'link.txt'));
    const collected = await collectOpenCodeTurnArtifacts(prepared.token, false);
    expect(collected.artifacts).toEqual([]);
    expect(collected.warnings.join(' ')).toContain('symbolic links');
  });
});
