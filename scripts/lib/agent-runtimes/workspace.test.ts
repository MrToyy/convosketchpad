import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENT_RUNTIME_WORKSPACE_DISPLAY_PATH,
  agentRuntimeWorkspaceDirectory,
  ensureAgentRuntimeWorkspace,
  ensureWorkspaceForAgentRuntimes,
} from './workspace.js';

const cleanups: string[] = [];

afterEach(() => {
  while (cleanups.length) rmSync(cleanups.pop()!, { recursive: true, force: true });
});

describe('shared Agent Runtime workspace', () => {
  it('uses the same home-relative path on Linux and macOS', () => {
    expect(AGENT_RUNTIME_WORKSPACE_DISPLAY_PATH).toBe('~/.convosketchpad/workspace');
    expect(agentRuntimeWorkspaceDirectory('/home/alice')).toBe('/home/alice/.convosketchpad/workspace');
    expect(agentRuntimeWorkspaceDirectory('/Users/alice')).toBe('/Users/alice/.convosketchpad/workspace');
  });

  it('creates an owner-only regular directory', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'runtime-workspace-'));
    cleanups.push(home);
    const directory = agentRuntimeWorkspaceDirectory(home);
    expect(ensureAgentRuntimeWorkspace(directory)).toBe(directory);
    expect(lstatSync(directory).isDirectory()).toBe(true);
    expect(lstatSync(directory).mode & 0o777).toBe(0o700);
  });

  it('rejects a symbolic-link workspace', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'runtime-workspace-'));
    const target = mkdtempSync(path.join(os.tmpdir(), 'runtime-workspace-target-'));
    cleanups.push(home, target);
    const directory = agentRuntimeWorkspaceDirectory(home);
    mkdirSync(path.dirname(directory), { recursive: true });
    symlinkSync(target, directory, 'dir');
    expect(() => ensureAgentRuntimeWorkspace(directory)).toThrow('not a regular directory');
  });

  it('creates the workspace only for a selected local Runtime', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'runtime-workspace-'));
    cleanups.push(home);
    const directory = agentRuntimeWorkspaceDirectory(home);
    expect(ensureWorkspaceForAgentRuntimes(['openclaw'], directory)).toBeNull();
    expect(() => lstatSync(directory)).toThrow();
    expect(ensureWorkspaceForAgentRuntimes(['openclaw', 'codex'], directory)).toBe(directory);
    expect(lstatSync(directory).isDirectory()).toBe(true);
  });
});
