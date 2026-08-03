import { readFileSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PackageMetadata {
  name: string;
  version: string;
  description: string;
}

const fallback: PackageMetadata = {
  name: 'convosketchpad',
  version: '0.0.0',
  description:
    'A visual branching workspace for agents — revisit any point and continue exploring.',
};

export function readPackageMetadata(moduleUrl = import.meta.url): PackageMetadata {
  let currentDir = dirname(fileURLToPath(moduleUrl));
  const rootDir = parse(currentDir).root;

  while (currentDir !== rootDir) {
    try {
      const pkg = JSON.parse(
        readFileSync(resolve(currentDir, 'package.json'), 'utf-8'),
      ) as Partial<PackageMetadata>;
      if (pkg.name === fallback.name) {
        return {
          name: pkg.name,
          version: pkg.version || fallback.version,
          description: pkg.description || fallback.description,
        };
      }
    } catch {
      // The module is emitted at different depths in server-dist and bin-dist.
    }
    currentDir = dirname(currentDir);
  }

  return fallback;
}

export const packageMetadata = readPackageMetadata();
