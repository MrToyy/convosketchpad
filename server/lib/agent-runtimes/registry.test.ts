import { describe, expect, it, vi } from 'vitest';
import type { AgentRuntime } from './contract.js';
import { configuredAgentRuntimeIds } from './configuration.js';
import { AgentRuntimeRegistry, createConfiguredAgentRuntimeRegistry } from './registry.js';

function runtime(id: string): AgentRuntime {
  return {
    id,
    close: vi.fn(),
  } as unknown as AgentRuntime;
}

describe('AgentRuntimeRegistry', () => {
  it('selects a Runtime only by its stable id', () => {
    const registry = new AgentRuntimeRegistry();
    const first = runtime('first');
    registry.register(first);
    expect(registry.get('first')).toBe(first);
    expect(registry.list()).toEqual([first]);
    expect(registry.has('first')).toBe(true);
    expect(registry.has('missing')).toBe(false);
    expect(() => registry.get('missing')).toThrow('not registered');
    expect(() => registry.register(runtime('first'))).toThrow('already registered');
  });

  it('closes every registered Runtime', () => {
    const registry = new AgentRuntimeRegistry();
    const first = runtime('first');
    const second = runtime('second');
    registry.register(first);
    registry.register(second);
    registry.close();
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    registry.close();
    expect(first.close).toHaveBeenCalledOnce();
    expect(() => registry.register(runtime('third'))).toThrow('Registry is closed');
  });

  it('creates Registry-owned adapter instances', () => {
    const first = createConfiguredAgentRuntimeRegistry(['openclaw']);
    const second = createConfiguredAgentRuntimeRegistry(['openclaw']);
    expect(first.get('openclaw')).not.toBe(second.get('openclaw'));
    first.close();
    second.close();
  });
});

describe('configuredAgentRuntimeIds', () => {
  it('uses OpenClaw only when the setting is absent', () => {
    expect(configuredAgentRuntimeIds(undefined)).toEqual(['openclaw']);
  });

  it('rejects empty, duplicate, and unsupported configurations', () => {
    expect(() => configuredAgentRuntimeIds('')).toThrow('at least one Runtime');
    expect(() => configuredAgentRuntimeIds('openclaw, openclaw')).toThrow('more than once');
    expect(() => configuredAgentRuntimeIds('codex')).toThrow('Unsupported Agent Runtime');
  });
});
