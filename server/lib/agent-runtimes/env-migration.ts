import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const LEGACY_KEY = 'AGENT_BACKENDS';
const CURRENT_KEY = 'AGENT_RUNTIMES';

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function configuredValues(lines: string[], key: string): string[] {
  const expression = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`);
  return lines.flatMap((line) => {
    const match = expression.exec(line);
    return match ? [unquote(match[1] || '')] : [];
  });
}

function singleValue(values: string[], key: string): string | null {
  if (values.length === 0) return null;
  const unique = [...new Set(values)];
  if (unique.length > 1) throw new Error(`Conflicting ${key} values in .env`);
  return unique[0] ?? null;
}

export function validateLegacyAgentRuntimeEnv(projectRoot: string): void {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  const legacyValue = singleValue(configuredValues(lines, LEGACY_KEY), LEGACY_KEY);
  const currentValue = singleValue(configuredValues(lines, CURRENT_KEY), CURRENT_KEY);
  if (legacyValue !== null && currentValue !== null && currentValue !== legacyValue) {
    throw new Error(`Conflicting ${LEGACY_KEY} and ${CURRENT_KEY} values in .env`);
  }
}

/**
 * Atomically replace the unreleased AGENT_BACKENDS key without retaining an
 * alias or writing both names. Values are never logged or returned.
 */
export function migrateLegacyAgentRuntimeEnv(projectRoot: string): boolean {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return false;
  const content = readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const legacyValue = singleValue(configuredValues(lines, LEGACY_KEY), LEGACY_KEY);
  if (legacyValue === null) return false;
  const currentValue = singleValue(configuredValues(lines, CURRENT_KEY), CURRENT_KEY);
  if (currentValue !== null && currentValue !== legacyValue) {
    throw new Error(`Conflicting ${LEGACY_KEY} and ${CURRENT_KEY} values in .env`);
  }

  let wroteCurrent = currentValue !== null;
  const legacyExpression = new RegExp(`^(\\s*)${LEGACY_KEY}(\\s*=.*)$`);
  const migrated = lines.flatMap((line) => {
    const match = legacyExpression.exec(line);
    if (!match) return [line];
    if (wroteCurrent) return [];
    wroteCurrent = true;
    return [`${match[1] || ''}${CURRENT_KEY}${match[2] || ''}`];
  });
  const trailingNewline = content.endsWith('\n');
  const next = migrated.join('\n').replace(/\n+$/, '') + (trailingNewline ? '\n' : '');
  const tmpPath = `${envPath}.runtime-migration.tmp`;
  try {
    writeFileSync(tmpPath, next, { encoding: 'utf8', mode: statSync(envPath).mode });
    renameSync(tmpPath, envPath);
    try { chmodSync(envPath, 0o600); } catch { /* non-fatal on Windows */ }
  } catch (error) {
    try { unlinkSync(tmpPath); } catch { /* no temporary file to remove */ }
    throw error;
  }
  return true;
}
