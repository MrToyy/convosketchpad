import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface PackageMetadata {
  version: string;
  description: string;
}

const fallback: PackageMetadata = {
  version: '0.0.0',
  description: 'A branching AI workspace for visual thinkers',
};

export function readPackageMetadata(): PackageMetadata {
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as Partial<PackageMetadata>;
    return {
      version: pkg.version || fallback.version,
      description: pkg.description || fallback.description,
    };
  } catch {
    return fallback;
  }
}

export const packageMetadata = readPackageMetadata();
