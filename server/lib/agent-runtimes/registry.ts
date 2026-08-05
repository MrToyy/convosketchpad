import type { AgentRuntime } from './contract.js';
import { agentRuntimeDefinitions, configuredAgentRuntimeIds } from './definitions.js';

export class AgentRuntimeRegistry {
  private readonly runtimes = new Map<string, AgentRuntime>();

  register(runtime: AgentRuntime): void {
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
    for (const runtime of this.runtimes.values()) runtime.close();
  }
}

export const agentRuntimeRegistry = new AgentRuntimeRegistry();
for (const runtimeId of configuredAgentRuntimeIds()) {
  agentRuntimeRegistry.register(agentRuntimeDefinitions[runtimeId].runtime);
}

export function getAgentRuntime(runtimeId: string): AgentRuntime {
  return agentRuntimeRegistry.get(runtimeId);
}
