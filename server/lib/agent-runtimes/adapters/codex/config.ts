import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MINIMUM_CODEX_VERSION = '0.146.0';

export const codexConfig = {
  get binary() { return process.env.CODEX_BIN?.trim() || 'codex'; },
  get workingDirectory() {
    const configured = process.env.CODEX_WORKING_DIRECTORY?.trim() || '';
    if (!configured) return '';
    if (configured === '~') return os.homedir();
    if (configured.startsWith('~/')) return path.join(os.homedir(), configured.slice(2));
    return path.resolve(configured);
  },
} as const;

export function validateCodexConfig(): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!codexConfig.workingDirectory) {
    errors.push('CODEX_WORKING_DIRECTORY is required when the Codex Runtime is enabled.');
  } else {
    try {
      const stat = fs.statSync(codexConfig.workingDirectory, { throwIfNoEntry: false });
      if (!stat?.isDirectory()) {
        errors.push(`CODEX_WORKING_DIRECTORY is not an existing directory: ${codexConfig.workingDirectory}`);
      } else {
        const codeHome = path.resolve(process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex'));
        const realWorkingDirectory = fs.realpathSync(codexConfig.workingDirectory);
        const realCodeHome = fs.existsSync(codeHome)
          ? fs.realpathSync(codeHome, { encoding: 'utf8' })
          : codeHome;
        const relativeToCodeHome = path.relative(realCodeHome, realWorkingDirectory);
        if (relativeToCodeHome === '' || (!relativeToCodeHome.startsWith('..') && !path.isAbsolute(relativeToCodeHome))) {
          errors.push('CODEX_WORKING_DIRECTORY must not be CODEX_HOME (~/.codex) or one of its subdirectories.');
        }
      }
    } catch (error) {
      if (!errors.some((message) => message.includes('CODEX_WORKING_DIRECTORY'))) {
        errors.push(`CODEX_WORKING_DIRECTORY cannot be inspected: ${error instanceof Error ? error.message : String(error)}`);
      }
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
