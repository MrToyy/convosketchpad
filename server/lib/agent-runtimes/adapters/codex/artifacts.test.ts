import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  collectCodexTurnArtifacts,
  materializeCodexManagedArtifact,
  prepareCodexTurnFiles,
  releaseCodexManagedArtifact,
} from './artifacts.js';

describe('Codex managed Artifacts', () => {
  let workspace = '';

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-artifacts-'));
    process.env.CODEX_WORKING_DIRECTORY = workspace;
  });

  afterEach(async () => {
    delete process.env.CODEX_WORKING_DIRECTORY;
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('collects, materializes, and releases arbitrary regular files', async () => {
    const prepared = await prepareCodexTurnFiles('reservation-1', []);
    await fs.mkdir(path.join(prepared.outputDirectory, 'reports'));
    await fs.writeFile(path.join(prepared.outputDirectory, 'reports', 'summary.csv'), 'name,value\na,1\n');

    const collected = await collectCodexTurnArtifacts(prepared.token, false);
    expect(collected.warnings).toEqual([]);
    expect(collected.artifacts).toHaveLength(1);
    expect(collected.artifacts[0]).toMatchObject({
      name: 'reports/summary.csv',
      mimeType: 'text/csv',
      available: true,
    });

    const handle = collected.artifacts[0].runtimeArtifactRef!;
    const materialized = await materializeCodexManagedArtifact(handle);
    expect(Buffer.from(materialized.bytes!)).toEqual(Buffer.from('name,value\na,1\n'));
    await releaseCodexManagedArtifact(handle);
    await expect(fs.stat(path.dirname(prepared.outputDirectory))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves safe partial files with an incomplete warning', async () => {
    const prepared = await prepareCodexTurnFiles('reservation-2', []);
    await fs.writeFile(path.join(prepared.outputDirectory, 'partial.txt'), 'partial');
    const collected = await collectCodexTurnArtifacts(prepared.token, true);
    expect(collected.artifacts[0].warning).toContain('may be incomplete');
  });

  it('rejects symlinks and hard links instead of following them', async () => {
    const prepared = await prepareCodexTurnFiles('reservation-3', []);
    const outside = path.join(workspace, 'outside.txt');
    await fs.writeFile(outside, 'secret');
    await fs.symlink(outside, path.join(prepared.outputDirectory, 'link.txt'));
    await fs.link(outside, path.join(prepared.outputDirectory, 'hard.txt'));
    const collected = await collectCodexTurnArtifacts(prepared.token, false);
    expect(collected.artifacts).toEqual([]);
    expect(collected.warnings.join(' ')).toMatch(/symbolic links|non-linked files/);
  });
});
