import { describe, expect, it } from 'vitest';
import { parseMigrateCliOptions } from './migrate-cli-options.js';

describe('migration CLI options', () => {
  it('parses supported modes', () => {
    expect(parseMigrateCliOptions([])).toEqual({ envOnly: false, rescanMedia: false, confirmOffline: false, help: false });
    expect(parseMigrateCliOptions(['--env-only'])).toEqual({ envOnly: true, rescanMedia: false, confirmOffline: false, help: false });
    expect(parseMigrateCliOptions(['--rescan-media', '--confirm-offline']))
      .toEqual({ envOnly: false, rescanMedia: true, confirmOffline: true, help: false });
    expect(parseMigrateCliOptions(['--help'])).toEqual({ envOnly: false, rescanMedia: false, confirmOffline: false, help: true });
  });

  it('rejects unknown and conflicting options before migration starts', () => {
    expect(() => parseMigrateCliOptions(['--unknown'])).toThrow('Unknown option(s): --unknown');
    expect(() => parseMigrateCliOptions(['--env-only', '--rescan-media']))
      .toThrow('--env-only cannot be combined with --rescan-media');
    expect(() => parseMigrateCliOptions(['--env-only', '--confirm-offline']))
      .toThrow('--env-only cannot be combined with --confirm-offline');
    expect(() => parseMigrateCliOptions(['--help', '--rescan-media']))
      .toThrow('--help cannot be combined with migration options');
    expect(() => parseMigrateCliOptions(['--env-only', '--env-only']))
      .toThrow('Duplicate option(s): --env-only');
    expect(() => parseMigrateCliOptions(['--help', '-h']))
      .toThrow('Duplicate option(s): --help');
  });
});
