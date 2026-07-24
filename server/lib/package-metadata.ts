import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PackageMetadata {
  name: string;
  version: string;
  description: string;
}

const fallback: PackageMetadata = {
  name: 'convosketchpad',
  version: '0.0.0',
  description: 'A branching AI workspace for visual thinkers',
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const packagePath = resolve(moduleDir, '../../package.json');

export function readPackageMetadata(): PackageMetadata {
  try {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8')) as Partial<PackageMetadata>;
    return {
      name: pkg.name || fallback.name,
      version: pkg.version || fallback.version,
      description: pkg.description || fallback.description,
    };
  } catch {
    return fallback;
  }
}

export const packageMetadata = readPackageMetadata();
