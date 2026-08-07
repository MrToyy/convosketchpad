import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { parse as parseDotenv } from 'dotenv';

export interface UpdaterStatePaths {
  dataDir: string;
  stateDir: string;
  snapshotsDir: string;
  lockPath: string;
  lastGoodPath: string;
  lastRunPath: string;
}

function expandHome(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

/** Resolve updater state from the process override, then the project .env, then the default. */
export function resolveUpdaterStatePaths(cwd: string): UpdaterStatePaths {
  let configured = process.env.CONVOSKETCHPAD_DATA_DIR?.trim();
  const envPath = join(cwd, '.env');
  if (!configured && existsSync(envPath)) {
    configured = parseDotenv(readFileSync(envPath, 'utf-8')).CONVOSKETCHPAD_DATA_DIR?.trim();
  }

  const expanded = expandHome(configured || join(homedir(), '.convosketchpad'));
  const dataDir = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
  const stateDir = join(dataDir, 'updater');
  return {
    dataDir,
    stateDir,
    snapshotsDir: join(stateDir, 'snapshots'),
    lockPath: join(stateDir, 'update.lock'),
    lastGoodPath: join(stateDir, 'last-good.json'),
    lastRunPath: join(stateDir, 'last-run.json'),
  };
}
