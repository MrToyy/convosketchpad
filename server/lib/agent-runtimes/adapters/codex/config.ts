import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  agentRuntimeWorkspaceDirectory,
  validateAgentRuntimeWorkspace,
} from '../../workspace.js';

export const MINIMUM_CODEX_VERSION = '0.146.0';

export const codexConfig = {
  get binary() { return process.env.CODEX_BIN?.trim() || 'codex'; },
  get workingDirectory() { return agentRuntimeWorkspaceDirectory(); },
} as const;

export function validateCodexConfig(): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  try {
    const workspaceValidation = validateAgentRuntimeWorkspace(codexConfig.workingDirectory);
    if (workspaceValidation !== true) {
      errors.push(workspaceValidation);
    } else {
      const codeHome = path.resolve(process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex'));
      const realWorkingDirectory = fs.realpathSync(codexConfig.workingDirectory);
      const realCodeHome = fs.existsSync(codeHome)
        ? fs.realpathSync(codeHome, { encoding: 'utf8' })
        : codeHome;
      const relativeToCodeHome = path.relative(realCodeHome, realWorkingDirectory);
      if (relativeToCodeHome === '' || (!relativeToCodeHome.startsWith('..') && !path.isAbsolute(relativeToCodeHome))) {
        errors.push('Agent Runtime workspace must not be CODEX_HOME (~/.codex) or one of its subdirectories.');
      }
    }
  } catch (error) {
    if (!errors.some((message) => message.includes('Agent Runtime workspace'))) {
      errors.push(`Agent Runtime workspace cannot be inspected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!codexConfig.binary) errors.push('CODEX_BIN must not be empty.');
  return { warnings, errors };
}

export function parseCodexVersion(output: string): string | null {
  return output.match(/(?:codex-cli\s+)?(\d+\.\d+\.\d+)/i)?.[1] || null;
}

export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}
