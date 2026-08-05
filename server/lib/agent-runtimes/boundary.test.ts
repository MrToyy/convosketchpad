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

  it('keeps concrete Runtime implementations in definitions and pure validators in configuration', () => {
    const root = path.resolve('server/lib/agent-runtimes');
    const adapterImports = readdirSync(root)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .flatMap((name) => {
        const source = readFileSync(path.join(root, name), 'utf8');
        return source.includes('./adapters/') ? [{ name, source }] : [];
      });

    expect(adapterImports.map(({ name }) => name)).toEqual(['configuration.ts', 'definitions.ts']);
    expect(adapterImports.find(({ name }) => name === 'definitions.ts')?.source)
      .toContain("./adapters/openclaw/index.js");
    expect(adapterImports.find(({ name }) => name === 'configuration.ts')?.source)
      .toContain("./adapters/openclaw/config.js");
  });

  it('keeps Canvas model and domain independent from transport, persistence, and Runtime composition', () => {
    const files = [
      path.resolve('server/lib/canvas/model.ts'),
      ...typeScriptFiles(path.resolve('server/lib/canvas/domain')),
    ];
    const forbidden = [
      '/routes/',
      '/application/',
      '/persistence/',
      'agent-runtimes/registry',
      'agent-runtimes/adapters/',
      "from 'hono'",
      "from 'node:sqlite'",
    ];
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return forbidden.filter((value) => source.includes(value)).map((value) => ({ file, value }));
    });
    expect(violations).toEqual([]);
  });
});
