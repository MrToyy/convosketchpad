import { describe, expect, it } from 'vitest';
import { configuredDefaultAgent } from './default-agent.js';

describe('configured default Agent', () => {
  it('parses a complete Agent Profile reference', () => {
    expect(configuredDefaultAgent({
      CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME: ' OPENCLAW ',
      CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE: ' main ',
    })).toEqual({ ref: { runtimeId: 'openclaw', profileId: 'main' } });
  });

  it('rejects partial configuration and permits no configured default', () => {
    expect(configuredDefaultAgent({})).toEqual({ ref: null });
    expect(configuredDefaultAgent({
      CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME: 'openclaw',
    })).toMatchObject({ ref: null, error: expect.stringContaining('must be configured together') });
  });
});
