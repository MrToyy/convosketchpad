import { afterEach, describe, expect, it, vi } from 'vitest';
import { printBanner } from './banner.js';
import { packageMetadata } from './package-metadata.js';

describe('setup banner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the package version and canonical tagline', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    printBanner();

    const output = log.mock.calls.flat().join(' ');
    expect(output).toContain(`ConvoSketchpad v${packageMetadata.version}`);
    expect(output).toContain(packageMetadata.description);
  });
});
