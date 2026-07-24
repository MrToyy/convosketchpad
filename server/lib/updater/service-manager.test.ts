import { describe, expect, it } from 'vitest';
import {
  findLaunchdLabelFromOutput,
  findSystemdUnitFromOutput,
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
});
