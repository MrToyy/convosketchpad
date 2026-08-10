import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const AGENT_RUNTIME_WORKSPACE_DISPLAY_PATH = '~/.convosketchpad/workspace';

/** Fixed, shared working directory for local Agent Runtimes. */
export function agentRuntimeWorkspaceDirectory(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, '.convosketchpad', 'workspace');
}

export function validateAgentRuntimeWorkspace(
  directory = agentRuntimeWorkspaceDirectory(),
): true | string {
  try {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return `Agent Runtime workspace is not a regular directory: ${directory}`;
    }
    return true;
  } catch {
    return `Agent Runtime workspace is not an existing directory: ${directory}`;
  }
}

/** Create the app-owned shared Runtime workspace with owner-only permissions. */
export function ensureAgentRuntimeWorkspace(
  directory = agentRuntimeWorkspaceDirectory(),
): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const validation = validateAgentRuntimeWorkspace(directory);
  if (validation !== true) throw new Error(validation);
  chmodSync(directory, 0o700);
  return directory;
}

export function ensureWorkspaceForAgentRuntimes(
  runtimeIds: readonly string[],
  directory = agentRuntimeWorkspaceDirectory(),
): string | null {
  const usesLocalWorkspace = runtimeIds.some(
    (runtimeId) => runtimeId === 'codex' || runtimeId === 'opencode',
  );
  return usesLocalWorkspace ? ensureAgentRuntimeWorkspace(directory) : null;
}
