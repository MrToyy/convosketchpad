import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('agent-workspace', () => {
  let homeDir: string;
  let workspaceRoot: string;

  beforeEach(async () => {
    vi.resetModules();
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workspace-test-'));
    workspaceRoot = path.join(homeDir, '.openclaw', 'workspace');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  async function loadModule() {
    vi.doMock('./config.js', () => ({
      config: {
        home: homeDir,
        workspaceRoot,
      },
    }));

    return import('./agent-workspace.js');
  }

  it('resolves main to the default workspace root', async () => {
    const { resolveAgentWorkspace } = await loadModule();

    expect(resolveAgentWorkspace()).toEqual({
      agentId: 'main',
      workspaceRoot,
    });

    expect(resolveAgentWorkspace('   ')).toEqual({
      agentId: 'main',
      workspaceRoot,
    });
  });

  it('falls back to a per-agent workspace for non-main agents', async () => {
    const { resolveAgentWorkspace } = await loadModule();

    expect(resolveAgentWorkspace('research')).toEqual({
      agentId: 'research',
      workspaceRoot: path.join(homeDir, '.openclaw', 'workspace-research'),
    });
  });

  it('prefers explicitly configured agent workspaces from openclaw.json', async () => {
    const configDir = path.join(homeDir, '.openclaw');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'openclaw.json'), JSON.stringify({
      agents: {
        defaults: { workspace: '/managed/workspaces' },
        list: [
          { id: 'research', workspace: '/vaults/research' },
        ],
      },
    }, null, 2));

    const { resolveAgentWorkspace } = await loadModule();

    expect(resolveAgentWorkspace('research')).toEqual({
      agentId: 'research',
      workspaceRoot: '/vaults/research',
    });
  });

  it('uses agents.defaults.workspace for new non-main agents when configured', async () => {
    const configDir = path.join(homeDir, '.openclaw');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'openclaw.json'), JSON.stringify({
      agents: {
        defaults: { workspace: '/managed/workspaces' },
      },
    }, null, 2));

    const { resolveAgentWorkspace } = await loadModule();

    expect(resolveAgentWorkspace('research')).toEqual({
      agentId: 'research',
      workspaceRoot: '/managed/workspaces/research',
    });
  });

  it('returns only the Canvas workspace identity', async () => {
    const { resolveAgentWorkspace } = await loadModule();

    const workspace = resolveAgentWorkspace('research');

    expect(workspace.workspaceRoot).toBe(path.join(homeDir, '.openclaw', 'workspace-research'));
    expect(workspace).toEqual({ agentId: 'research', workspaceRoot: path.join(homeDir, '.openclaw', 'workspace-research') });
  });

  it('rejects invalid agent ids', async () => {
    const { resolveAgentWorkspace } = await loadModule();

    expect(() => resolveAgentWorkspace('../oops')).toThrow(/agent id/i);
    expect(() => resolveAgentWorkspace('bad/name')).toThrow(/agent id/i);
    expect(() => resolveAgentWorkspace('two words')).toThrow(/agent id/i);
    expect(() => resolveAgentWorkspace('bad_agent')).toThrow(/agent id/i);
  });
});
