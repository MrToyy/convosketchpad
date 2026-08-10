import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenCodeServerClient } from './server-client.js';

describe('OpenCode Server supervision', () => {
  const originalBinary = process.env.OPENCODE_BIN;
  let temporaryDirectory = '';

  afterEach(() => {
    if (originalBinary === undefined) delete process.env.OPENCODE_BIN; else process.env.OPENCODE_BIN = originalBinary;
    vi.restoreAllMocks();
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = '';
  });

  it('restarts an unexpectedly exited server with backoff and stops after close', async () => {
    temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'opencode-server-client-'));
    vi.spyOn(os, 'homedir').mockReturnValue(temporaryDirectory);
    mkdirSync(path.join(temporaryDirectory, '.convosketchpad', 'workspace'), { recursive: true });
    const launches = path.join(temporaryDirectory, 'launches.txt');
    const executable = path.join(temporaryDirectory, 'opencode-stub');
    writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv[2] === '--version') {
  process.stdout.write('1.18.16\\n');
  process.exit(0);
}
if (process.argv[2] === 'serve') {
  fs.appendFileSync(${JSON.stringify(launches)}, 'start\\n');
  process.exit(1);
}
process.exit(64);
`);
    chmodSync(executable, 0o700);
    process.env.OPENCODE_BIN = executable;

    const client = new OpenCodeServerClient(async () => 45_321);
    await expect(client.connect()).rejects.toThrow();
    const deadline = Date.now() + 3_500;
    while ((!existsSync(launches) || readFileSync(launches, 'utf8').trim().split('\n').length < 4) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(readFileSync(launches, 'utf8').trim().split('\n').length).toBeGreaterThanOrEqual(4);
    client.close();
    const stoppedAt = readFileSync(launches, 'utf8').trim().split('\n').length;
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    expect(readFileSync(launches, 'utf8').trim().split('\n')).toHaveLength(stoppedAt);
  }, 9_000);
});
