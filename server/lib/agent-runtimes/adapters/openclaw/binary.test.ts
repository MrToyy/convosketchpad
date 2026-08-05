import { describe, expect, it } from 'vitest';
import { resolveOpenclawBin } from './binary.js';

describe('OpenClaw binary resolution', () => {
  it('uses an explicit command and otherwise delegates discovery to PATH', () => {
    expect(resolveOpenclawBin(' /custom/bin/openclaw ')).toBe('/custom/bin/openclaw');
    expect(resolveOpenclawBin('')).toBe('openclaw');
  });
});
