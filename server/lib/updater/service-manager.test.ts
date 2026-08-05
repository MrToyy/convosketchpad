import { describe, expect, it } from 'vitest';
import {
  findLaunchdLabelFromOutput,
  findSystemdUnitFromOutput,
  serviceConfigurationMatchesInstallation,
  systemdStateFromOutput,
  systemdControlInvocation,
} from './service-manager.js';

describe('service manager identifiers', () => {
  it('matches only the exact systemd unit', () => {
    expect(findSystemdUnitFromOutput([
      'other-convosketchpad.service loaded active running Wrong service',
      'convosketchpad.service loaded active running ConvoSketchpad',
    ].join('\n'))).toBe('convosketchpad.service');
    expect(findSystemdUnitFromOutput(
      'other-convosketchpad.service loaded active running Wrong service',
    )).toBeNull();
  });

  it('matches only the exact launchd label', () => {
    expect(findLaunchdLabelFromOutput([
      '123 0 com.example.convosketchpad',
      '456 0 com.mrtoyy.convosketchpad',
    ].join('\n'))).toBe('com.mrtoyy.convosketchpad');
    expect(findLaunchdLabelFromOutput('123 0 com.example.convosketchpad')).toBeNull();
  });

  it('uses sudo only for system-unit mutations by a non-root process', () => {
    expect(systemdControlInvocation(false, ['restart', 'convosketchpad.service'], {
      isRoot: false,
      interactive: true,
    })).toEqual({
      command: 'sudo',
      args: ['systemctl', 'restart', 'convosketchpad.service'],
      stdio: 'inherit',
    });
    expect(systemdControlInvocation(false, ['stop', 'convosketchpad.service'], {
      isRoot: false,
      interactive: false,
    })).toEqual({
      command: 'sudo',
      args: ['-n', 'systemctl', 'stop', 'convosketchpad.service'],
      stdio: 'pipe',
    });
  });

  it('controls root and user units without sudo', () => {
    expect(systemdControlInvocation(false, ['restart', 'convosketchpad.service'], {
      isRoot: true,
    }).command).toBe('systemctl');
    expect(systemdControlInvocation(true, ['restart', 'convosketchpad.service'], {
      isRoot: false,
    })).toMatchObject({ command: 'systemctl', args: ['--user', 'restart', 'convosketchpad.service'] });
  });

  it('accepts only service configurations owned by the current installation', () => {
    expect(serviceConfigurationMatchesInstallation(
      '/srv/convosketchpad',
      '/usr/bin/node server-dist/index.js',
      '/srv/convosketchpad',
    )).toBe(true);
    expect(serviceConfigurationMatchesInstallation(
      '/srv/other-install',
      '/usr/bin/node server-dist/index.js',
      '/srv/convosketchpad',
    )).toBe(false);
    expect(serviceConfigurationMatchesInstallation(
      '/srv/convosketchpad',
      '/usr/bin/node unrelated.js',
      '/srv/convosketchpad',
    )).toBe(false);
    expect(serviceConfigurationMatchesInstallation(
      '/srv/convosketchpad',
      '/usr/bin/node /srv/other-install/server-dist/index.js',
      '/srv/convosketchpad',
    )).toBe(false);
  });

  it('does not collapse indeterminate service states into inactive', () => {
    expect(systemdStateFromOutput('active\n')).toBe('active');
    expect(systemdStateFromOutput('inactive\n')).toBe('inactive');
    expect(systemdStateFromOutput('failed\n')).toBe('inactive');
    expect(systemdStateFromOutput('activating\n')).toBe('unknown');
    expect(systemdStateFromOutput('')).toBe('unknown');
  });
});
