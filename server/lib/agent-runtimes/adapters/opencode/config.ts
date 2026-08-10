import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  agentRuntimeWorkspaceDirectory,
  validateAgentRuntimeWorkspace,
} from '../../workspace.js';

export const MINIMUM_OPENCODE_VERSION = '1.18.16';

export const openCodeConfig = {
  get binary() { return process.env.OPENCODE_BIN?.trim() || 'opencode'; },
  get workingDirectory() { return agentRuntimeWorkspaceDirectory(); },
} as const;

export function validateOpenCodeConfig(): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  try {
    const workspaceValidation = validateAgentRuntimeWorkspace(openCodeConfig.workingDirectory);
    if (workspaceValidation !== true) {
      errors.push(workspaceValidation);
    } else {
      const stateRoots = [
        path.join(os.homedir(), '.config', 'opencode'),
        path.join(os.homedir(), '.local', 'share', 'opencode'),
      ];
      const realWorkingDirectory = fs.realpathSync(openCodeConfig.workingDirectory);
      for (const stateRoot of stateRoots) {
        const comparableRoot = fs.existsSync(stateRoot) ? fs.realpathSync(stateRoot) : path.resolve(stateRoot);
        const relative = path.relative(comparableRoot, realWorkingDirectory);
        if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
          errors.push('Agent Runtime workspace must not be an OpenCode configuration or state directory.');
          break;
        }
      }
    }
  } catch (error) {
    if (!errors.some((message) => message.includes('Agent Runtime workspace'))) {
      errors.push(`Agent Runtime workspace cannot be inspected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!openCodeConfig.binary) errors.push('OPENCODE_BIN must not be empty.');
  return { warnings, errors };
}

export function parseOpenCodeVersion(output: string): string | null {
  return output.match(/(?:opencode\s+)?(\d+\.\d+\.\d+)/i)?.[1] || null;
}

export function compareOpenCodeVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}
