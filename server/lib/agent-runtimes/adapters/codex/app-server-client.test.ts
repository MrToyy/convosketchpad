import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexAppServerClient } from './app-server-client.js';

describe('Codex App Server supervision', () => {
  const originalBinary = process.env.CODEX_BIN;
  const originalWorkingDirectory = process.env.CODEX_WORKING_DIRECTORY;
  let temporaryDirectory = '';

  afterEach(() => {
    if (originalBinary === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = originalBinary;
    if (originalWorkingDirectory === undefined) delete process.env.CODEX_WORKING_DIRECTORY;
    else process.env.CODEX_WORKING_DIRECTORY = originalWorkingDirectory;
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = '';
  });

  it('restarts an unexpectedly exited process with backoff and stops after close', async () => {
    temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'codex-app-server-client-'));
    const launches = path.join(temporaryDirectory, 'launches.txt');
    const executable = path.join(temporaryDirectory, 'codex-stub');
    writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv[2] === '--version') {
  process.stdout.write('codex-cli 0.146.0\\n');
  process.exit(0);
}
if (process.argv[2] === 'app-server') {
  fs.appendFileSync(${JSON.stringify(launches)}, 'start\\n');
  process.exit(1);
}
process.exit(64);
`);
    chmodSync(executable, 0o700);
    process.env.CODEX_BIN = executable;
    process.env.CODEX_WORKING_DIRECTORY = temporaryDirectory;

    const client = new CodexAppServerClient();
    await expect(client.connect()).rejects.toThrow();
    const deadline = Date.now() + 3_000;
    while (readFileSync(launches, 'utf8').trim().split('\n').length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(readFileSync(launches, 'utf8').trim().split('\n')).toHaveLength(2);

    client.close();
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    expect(readFileSync(launches, 'utf8').trim().split('\n')).toHaveLength(2);
  }, 8_000);
});
