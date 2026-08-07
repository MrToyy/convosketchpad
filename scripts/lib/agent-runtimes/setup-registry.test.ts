import { describe, expect, it } from 'vitest';
import {
  groupRuntimeDetections,
  selectedAgentRuntimeSetupDrivers,
  type RuntimeSetupDetection,
} from './setup-registry.js';

describe('Agent Runtime setup registry', () => {
  it('keeps detected and undetected Runtimes in separate groups', () => {
    const detected: RuntimeSetupDetection = {
      runtimeId: 'openclaw',
      displayName: 'OpenClaw',
      detected: true,
      configured: true,
      message: 'ready',
    };
    const missing = { ...detected, detected: false, configured: false, message: 'missing' };

    expect(groupRuntimeDetections([detected, missing])).toEqual({
      detected: [detected],
      undetected: [missing],
    });
  });

  it('returns setup Drivers only for explicitly selected Runtimes', () => {
    expect(selectedAgentRuntimeSetupDrivers(['codex', 'openclaw']).map((driver) => driver.id))
      .toEqual(['codex', 'openclaw']);
  });
});
