import {
  chmodSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/** Write updater state without exposing a partially-written recovery record. */
export function writePrivateJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    const descriptor = openSync(temporaryPath, 'r');
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}
