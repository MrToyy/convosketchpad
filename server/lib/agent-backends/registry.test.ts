import { describe, expect, it, vi } from 'vitest';
import type { AgentBackend } from './contract.js';
import { configuredAgentBackendIds } from './config.js';
import { AgentBackendRegistry } from './registry.js';

function backend(id: string): AgentBackend {
  return {
    id,
    close: vi.fn(),
  } as unknown as AgentBackend;
}

describe('AgentBackendRegistry', () => {
  it('selects a Backend only by its stable id', () => {
    const registry = new AgentBackendRegistry();
    const first = backend('first');
    registry.register(first);
    expect(registry.get('first')).toBe(first);
    expect(registry.list()).toEqual([first]);
    expect(registry.has('first')).toBe(true);
    expect(registry.has('missing')).toBe(false);
    expect(() => registry.get('missing')).toThrow('not registered');
    expect(() => registry.register(backend('first'))).toThrow('already registered');
  });

  it('closes every registered Backend', () => {
    const registry = new AgentBackendRegistry();
    const first = backend('first');
    const second = backend('second');
    registry.register(first);
    registry.register(second);
    registry.close();
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
  });
});

describe('configuredAgentBackendIds', () => {
  it('uses OpenClaw only when the setting is absent', () => {
    expect(configuredAgentBackendIds(undefined)).toEqual(['openclaw']);
  });

  it('rejects empty, duplicate, and unsupported configurations', () => {
    expect(() => configuredAgentBackendIds('')).toThrow('at least one Backend');
    expect(() => configuredAgentBackendIds('openclaw, openclaw')).toThrow('more than once');
    expect(() => configuredAgentBackendIds('codex')).toThrow('Unsupported Agent Backend');
  });
});
