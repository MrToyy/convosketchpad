import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function typeScriptFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return typeScriptFiles(target);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [target]
      : [];
  });
}

describe('Agent Runtime architecture boundary', () => {
  it('keeps concrete Adapter imports out of Canvas business modules and routes', () => {
    const canvasRoot = path.resolve('server/lib/canvas');
    const libRoot = path.resolve('server/lib');
    const files = [
      ...typeScriptFiles(path.resolve('server/routes')),
      ...typeScriptFiles(canvasRoot),
      ...readdirSync(libRoot)
        .filter((name) => name.startsWith('canvas-') && name.endsWith('.ts') && !name.endsWith('.test.ts'))
        .map((name) => path.join(libRoot, name)),
    ];

    const violations = files.filter((file) =>
      readFileSync(file, 'utf8').includes('agent-runtimes/adapters/'));
    expect(violations).toEqual([]);
  });

  it('allows only definitions.ts to compose concrete Adapters at the Runtime root', () => {
    const root = path.resolve('server/lib/agent-runtimes');
    const importsAdapter = readdirSync(root)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .filter((name) => readFileSync(path.join(root, name), 'utf8').includes('./adapters/'));

    expect(importsAdapter).toEqual(['definitions.ts']);
  });
});
