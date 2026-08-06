import { describe, expect, it } from 'vitest';
import { parseSetupCliOptions } from './setup-cli-options.js';

const supported = ['openclaw', 'codex'];

describe('setup CLI options', () => {
  it('parses an explicit non-interactive Runtime configuration', () => {
    expect(parseSetupCliOptions([
      '--defaults',
      '--runtimes', 'openclaw',
      '--default-agent', 'openclaw/main',
      '--access-mode', 'tailscale',
    ], supported)).toMatchObject({
      defaults: true,
      runtimeIds: ['openclaw'],
      defaultAgent: { runtimeId: 'openclaw', profileId: 'main' },
      accessMode: 'tailscale-ip',
    });
  });

  it('accepts Codex as a Runtime and default Agent', () => {
    expect(parseSetupCliOptions([
      '--defaults',
      '--runtimes', 'codex',
      '--default-agent', 'codex/default',
    ], supported)).toMatchObject({
      runtimeIds: ['codex'],
      defaultAgent: { runtimeId: 'codex', profileId: 'default' },
    });
  });

  it.each([
    [['--unknown'], 'Unknown option'],
    [['--runtimes'], 'requires a value'],
    [['--runtimes', 'openclaw,openclaw'], 'duplicate value'],
    [['--runtimes', 'hermes'], 'Unsupported'],
    [['--defaults', '--defaults'], 'Duplicate option'],
    [['--check', '--defaults'], 'cannot be combined'],
    [['--help', '--defaults'], 'cannot be combined'],
    [['--access-mode', 'local'], 'requires --defaults'],
    [['--default-agent', 'hermes/main'], 'Unsupported default Agent Runtime'],
    [['--gateway-timezone', 'Asia/Shanghai'], 'Unknown option'],
  ])('rejects invalid arguments: %j', (args, message) => {
    expect(() => parseSetupCliOptions(args, supported)).toThrow(message);
  });
});
