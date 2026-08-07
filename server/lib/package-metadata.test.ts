import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPackageMetadata } from './package-metadata.js';

let tempRoot = '';

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'package-metadata-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({
    name: 'convosketchpad',
    version: '1.2.3',
    description: 'Test package',
  }));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('package metadata', () => {
  it.each([
    ['source', 'server/lib/package-metadata.js'],
    ['server build', 'server-dist/lib/package-metadata.js'],
    ['CLI build', 'bin-dist/server/lib/package-metadata.js'],
  ])('finds the project package from the %s layout', async (_layout, modulePath) => {
    const absoluteModulePath = path.join(tempRoot, modulePath);
    await fs.mkdir(path.dirname(absoluteModulePath), { recursive: true });

    expect(readPackageMetadata(pathToFileURL(absoluteModulePath).href)).toEqual({
      name: 'convosketchpad',
      version: '1.2.3',
      description: 'Test package',
    });
  });

  it('does not use metadata from an unrelated parent package', async () => {
    await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({
      name: 'another-package',
      version: '9.9.9',
      description: 'Wrong package',
    }));
    const modulePath = path.join(tempRoot, 'bin-dist/server/lib/package-metadata.js');

    expect(readPackageMetadata(pathToFileURL(modulePath).href)).toEqual({
      name: 'convosketchpad',
      version: '0.0.0',
      description:
        'A visual branching workspace for agents — revisit any point and continue exploring.',
    });
  });
});
