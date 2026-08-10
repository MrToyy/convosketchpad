import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectOpenCodeRuntime } from './detect.js';

describe('OpenCode Runtime detection', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function executable(output: string): string {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'convosketchpad-opencode-detect-'));
    directories.push(directory);
    const command = path.join(directory, 'opencode');
    writeFileSync(command, `#!/bin/sh\n[ "$#" -eq 1 ] && [ "$1" = "--version" ] || exit 64\nprintf '%s\\n' '${output}'\n`);
    chmodSync(command, 0o700);
    return command;
  }

  it('uses only --version and accepts the tested minimum', () => {
    const command = executable('1.18.16');
    expect(detectOpenCodeRuntime({ configuredBin: command })).toMatchObject({
      detected: true, resolvedBinary: command, version: '1.18.16', supported: true,
    });
  });

  it('rejects an older version', () => {
    expect(detectOpenCodeRuntime({ configuredBin: executable('1.18.15') })).toMatchObject({
      detected: true, version: '1.18.15', supported: false,
    });
  });
});
