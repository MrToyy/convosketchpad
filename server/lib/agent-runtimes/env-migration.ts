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
import { LEGACY_RUNTIME_ENV_MAPPINGS } from './env-keys.js';

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

export function validateLegacyRuntimeEnv(projectRoot: string): void {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const [legacyKey, currentKey] of LEGACY_RUNTIME_ENV_MAPPINGS) {
    const legacyValue = singleValue(configuredValues(lines, legacyKey), legacyKey);
    const currentValue = singleValue(configuredValues(lines, currentKey), currentKey);
    if (legacyValue !== null && currentValue !== null && currentValue !== legacyValue) {
      throw new Error(`Conflicting ${legacyKey} and ${currentKey} values in .env`);
    }
  }
}

/**
 * Atomically replace v0.3.x Runtime keys without retaining aliases or writing
 * both names. Every conflict is validated before writing, and values are never
 * logged or returned.
 */
export function migrateLegacyRuntimeEnv(projectRoot: string): boolean {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return false;
  const content = readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const migrations = LEGACY_RUNTIME_ENV_MAPPINGS.map(([legacyKey, currentKey]) => {
    const legacyValue = singleValue(configuredValues(lines, legacyKey), legacyKey);
    const currentValue = singleValue(configuredValues(lines, currentKey), currentKey);
    if (legacyValue !== null && currentValue !== null && currentValue !== legacyValue) {
      throw new Error(`Conflicting ${legacyKey} and ${currentKey} values in .env`);
    }
    return { legacyKey, currentKey, legacyValue, currentValue };
  });
  if (!migrations.some(({ legacyValue }) => legacyValue !== null)) return false;

  let migrated = lines;
  for (const { legacyKey, currentKey, legacyValue, currentValue } of migrations) {
    if (legacyValue === null) continue;
    let wroteCurrent = currentValue !== null;
    const legacyExpression = new RegExp(`^(\\s*)${legacyKey}(\\s*=.*)$`);
    migrated = migrated.flatMap((line) => {
      const match = legacyExpression.exec(line);
      if (!match) return [line];
      if (wroteCurrent) return [];
      wroteCurrent = true;
      return [`${match[1] || ''}${currentKey}${match[2] || ''}`];
    });
  }

  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const next = migrated.join(newline);
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
