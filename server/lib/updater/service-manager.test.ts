import { describe, expect, it } from 'vitest';
import {
  findLaunchdLabelFromOutput,
  findSystemdUnitFromOutput,
} from './service-manager.js';

describe('service manager identifiers', () => {
  it('matches only the exact systemd unit', () => {
    expect(findSystemdUnitFromOutput([
      'other-nerve.service loaded active running Wrong service',
      'nerve.service loaded active running ConvoSketchpad',
    ].join('\n'))).toBe('nerve.service');
    expect(findSystemdUnitFromOutput(
      'other-nerve.service loaded active running Wrong service',
    )).toBeNull();
  });

  it('matches only the exact launchd label', () => {
    expect(findLaunchdLabelFromOutput([
      '123 0 com.example.nerve',
      '456 0 com.nerve.server',
    ].join('\n'))).toBe('com.nerve.server');
    expect(findLaunchdLabelFromOutput('123 0 com.example.nerve')).toBeNull();
  });
});
