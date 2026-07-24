import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runPreflight } from './preflight.js';

describe('updater preflight', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'convosketchpad-preflight-'));
    execFileSync('git', ['init', '-q'], { cwd });
    execFileSync('git', [
      'remote',
      'add',
      'origin',
      'https://github.com/MrToyy/convosketchpad.git',
    ], { cwd });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function commitTrackedFile(): void {
    writeFileSync(join(cwd, 'tracked.txt'), 'initial\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd });
    execFileSync('git', [
      '-c', 'user.name=Test',
      '-c', 'user.email=test@example.com',
      'commit', '-qm', 'initial',
    ], { cwd });
  }

  it('accepts a clean checkout with the official HTTPS origin', () => {
    expect(runPreflight(cwd)).toMatchObject({
      isGitRepo: true,
      hasWritePermission: true,
      isClean: true,
    });
  });

  it('rejects a non-official origin', () => {
    execFileSync('git', ['remote', 'set-url', 'origin', 'https://github.com/example/fork.git'], { cwd });
    expect(() => runPreflight(cwd)).toThrow(/official ConvoSketchpad repository/);
  });

  it.each([
    ['unstaged', () => {
      commitTrackedFile();
      writeFileSync(join(cwd, 'tracked.txt'), 'changed\n');
    }],
    ['staged', () => {
      commitTrackedFile();
      writeFileSync(join(cwd, 'tracked.txt'), 'changed\n');
      execFileSync('git', ['add', 'tracked.txt'], { cwd });
    }],
    ['untracked', () => {
      writeFileSync(join(cwd, 'untracked.txt'), 'new\n');
    }],
  ])('rejects a dirty checkout with %s changes', (_kind, arrange) => {
    arrange();
    expect(() => runPreflight(cwd)).toThrow(/Working tree is not clean/);
  });
});
