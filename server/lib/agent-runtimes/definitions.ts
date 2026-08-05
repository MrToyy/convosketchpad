import type { AgentRuntime } from './contract.js';
import { createOpenClawAgentRuntime } from './adapters/openclaw/index.js';
import type { SupportedAgentRuntimeId } from './manifest.js';

export interface AgentRuntimeDefinition {
  id: string;
  createRuntime: () => AgentRuntime;
}

export const agentRuntimeDefinitions = {
  openclaw: {
    id: 'openclaw',
    createRuntime: createOpenClawAgentRuntime,
  },
} satisfies Record<SupportedAgentRuntimeId, AgentRuntimeDefinition>;
