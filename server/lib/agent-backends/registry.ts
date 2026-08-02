import type { AgentBackend } from './contract.js';
import { openClawAgentBackend } from './adapters/openclaw/index.js';
import { configuredAgentBackendIds } from './config.js';

export class AgentBackendRegistry {
  private readonly backends = new Map<string, AgentBackend>();

  register(backend: AgentBackend): void {
    if (this.backends.has(backend.id)) throw new Error(`Agent Backend already registered: ${backend.id}`);
    this.backends.set(backend.id, backend);
  }

  get(backendId: string): AgentBackend {
    const backend = this.backends.get(backendId);
    if (!backend) throw new Error(`Agent Backend is not registered: ${backendId}`);
    return backend;
  }

  list(): AgentBackend[] {
    return [...this.backends.values()];
  }

  has(backendId: string): boolean {
    return this.backends.has(backendId);
  }

  close(): void {
    for (const backend of this.backends.values()) backend.close();
  }
}

export const agentBackendRegistry = new AgentBackendRegistry();
for (const backendId of configuredAgentBackendIds()) {
  if (backendId === 'openclaw') agentBackendRegistry.register(openClawAgentBackend);
}

export function getAgentBackend(backendId: string): AgentBackend {
  return agentBackendRegistry.get(backendId);
}
