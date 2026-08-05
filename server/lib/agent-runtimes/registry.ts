import type { AgentRuntime } from './contract.js';
import { agentRuntimeDefinitions } from './definitions.js';
import { configuredAgentRuntimeIds } from './configuration.js';

export class AgentRuntimeRegistry {
  private readonly runtimes = new Map<string, AgentRuntime>();
  private closed = false;

  register(runtime: AgentRuntime): void {
    if (this.closed) throw new Error('Agent Runtime Registry is closed');
    if (this.runtimes.has(runtime.id)) throw new Error(`Agent Runtime already registered: ${runtime.id}`);
    this.runtimes.set(runtime.id, runtime);
  }

  get(runtimeId: string): AgentRuntime {
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) throw new Error(`Agent Runtime is not registered: ${runtimeId}`);
    return runtime;
  }

  list(): AgentRuntime[] {
    return [...this.runtimes.values()];
  }

  has(runtimeId: string): boolean {
    return this.runtimes.has(runtimeId);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const runtime of this.runtimes.values()) runtime.close();
  }
}

export function createConfiguredAgentRuntimeRegistry(
  runtimeIds = configuredAgentRuntimeIds(),
): AgentRuntimeRegistry {
  const registry = new AgentRuntimeRegistry();
  for (const runtimeId of runtimeIds) {
    registry.register(agentRuntimeDefinitions[runtimeId].createRuntime());
  }
  return registry;
}
