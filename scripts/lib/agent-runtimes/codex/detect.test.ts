import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectCodexRuntime } from './detect.js';

describe('Codex Runtime detection', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function executable(output: string): { directory: string; command: string } {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'convosketchpad-codex-detect-'));
    directories.push(directory);
    const command = path.join(directory, 'codex');
    writeFileSync(command, `#!/bin/sh\n[ "$#" -eq 1 ] && [ "$1" = "--version" ] || exit 64\nprintf '%s\\n' '${output}'\n`);
    chmodSync(command, 0o700);
    return { directory, command };
  }

  it('uses only --version and accepts the tested minimum', () => {
    const current = executable('codex-cli 0.146.0');
    expect(detectCodexRuntime({ configuredBin: current.command })).toMatchObject({
      detected: true,
      resolvedBinary: current.command,
      version: '0.146.0',
      supported: true,
    });
  });

  it('rejects an older CLI version', () => {
    const old = executable('codex-cli 0.145.0');
    expect(detectCodexRuntime({ configuredBin: old.command })).toMatchObject({
      detected: true,
      version: '0.145.0',
      supported: false,
    });
  });
});
