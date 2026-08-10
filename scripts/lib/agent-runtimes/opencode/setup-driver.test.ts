import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCodeSetupDriver } from './setup-driver.js';

describe('OpenCode setup driver', () => {
  it('reports the fixed shared workspace without an environment setting', () => {
    expect(openCodeSetupDriver.executableEnvKey).toBe('OPENCODE_BIN');
    expect(openCodeSetupDriver.summary({ AGENT_RUNTIMES: 'opencode' })).toContainEqual({
      label: 'OpenCode cwd',
      value: path.join(os.homedir(), '.convosketchpad', 'workspace'),
    });
  });
});
