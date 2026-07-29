import { afterEach, describe, expect, it, vi } from 'vitest';
import { printBanner } from './banner.js';

describe('setup banner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the package version and canonical tagline', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    printBanner();

    const output = log.mock.calls.flat().join(' ');
    expect(output).toContain('ConvoSketchpad v0.3.0');
    expect(output).toContain('A branching AI workspace for visual thinkers');
  });
});
