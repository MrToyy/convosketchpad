import { describe, expect, it } from 'vitest';
import { parseUpdateCliOptions, validateUpdateOptionCombination } from './cli-options.js';
import type { UpdateOptions } from './types.js';

function options(overrides: Partial<UpdateOptions> = {}): UpdateOptions {
  return {
    cwd: '/project',
    yes: false,
    dryRun: false,
    verbose: false,
    rollback: false,
    noRestart: false,
    ...overrides,
  };
}

describe('updater CLI option validation', () => {
  it('allows ordinary updates and an unqualified rollback', () => {
    expect(validateUpdateOptionCombination(options())).toBeNull();
    expect(validateUpdateOptionCombination(options({ rollback: true }))).toBeNull();
  });

  it('rejects rollback combinations that could unexpectedly mutate state', () => {
    expect(validateUpdateOptionCombination(options({ rollback: true, dryRun: true })))
      .toBe('--rollback cannot be combined with --dry-run');
    expect(validateUpdateOptionCombination(options({
      rollback: true,
      version: 'v0.4.0',
      noRestart: true,
    }))).toBe('--rollback cannot be combined with --version, --no-restart');
  });

  it('rejects unknown, duplicate, and missing-value options', () => {
    expect(() => parseUpdateCliOptions(['--wat'], '/project')).toThrow('Unknown option');
    expect(() => parseUpdateCliOptions(['--yes', '-y'], '/project')).toThrow('Duplicate option');
    expect(() => parseUpdateCliOptions(['--version', '--dry-run'], '/project'))
      .toThrow('--version requires a value');
  });

  it('accepts help only when it is the sole option', () => {
    expect(parseUpdateCliOptions(['--help'], '/project').help).toBe(true);
    expect(() => parseUpdateCliOptions(['--help', '--dry-run'], '/project'))
      .toThrow('--help cannot be combined');
    expect(() => parseUpdateCliOptions(['--help', '--unknown'], '/project'))
      .toThrow('Unknown option');
  });
});
