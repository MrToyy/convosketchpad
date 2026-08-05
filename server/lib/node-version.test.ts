import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isSupportedNodeVersion, MINIMUM_NODE_VERSION } from './node-version.js';

describe('Node.js version requirement', () => {
  it('matches the package runtime floor', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { engines: { node: string } };
    expect(packageJson.engines.node).toBe(`>=${MINIMUM_NODE_VERSION}`);
  });

  it.each([
    ['v22.12.9', false],
    ['22.13.0', true],
    ['v22.14.0', true],
    ['v23.0.0', true],
    ['not-a-version', false],
  ])('evaluates %s', (version, expected) => {
    expect(isSupportedNodeVersion(version)).toBe(expected);
  });
});
