import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { codexSetupDriver } from './setup-driver.js';

describe('Codex setup driver', () => {
  it('reports the fixed shared workspace without an environment setting', () => {
    expect(codexSetupDriver.executableEnvKey).toBe('CODEX_BIN');
    expect(codexSetupDriver.summary({ AGENT_RUNTIMES: 'codex' })).toContainEqual({
      label: 'Codex cwd',
      value: path.join(os.homedir(), '.convosketchpad', 'workspace'),
    });
  });
});
