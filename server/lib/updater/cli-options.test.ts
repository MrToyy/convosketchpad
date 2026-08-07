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
    resume: false,
    status: false,
    noRestart: false,
    leaveStopped: false,
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

  it('keeps recovery and status modes standalone', () => {
    expect(validateUpdateOptionCombination(options({ resume: true }))).toBeNull();
    expect(validateUpdateOptionCombination(options({ status: true }))).toBeNull();
    expect(validateUpdateOptionCombination(options({ resume: true, status: true })))
      .toBe('--resume, --status are mutually exclusive');
    expect(validateUpdateOptionCombination(options({ resume: true, version: 'v0.4.1' })))
      .toBe('--resume cannot be combined with --version');
    expect(parseUpdateCliOptions(['--status'], '/project').options.status).toBe(true);
    expect(parseUpdateCliOptions(['--resume'], '/project').options.resume).toBe(true);
  });

  it('distinguishes leaving a migrated service stopped from code-only updates', () => {
    expect(parseUpdateCliOptions(['--leave-stopped'], '/project').options.leaveStopped).toBe(true);
    expect(() => parseUpdateCliOptions(['--leave-stopped', '--no-restart'], '/project'))
      .toThrow('cannot be combined');
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
