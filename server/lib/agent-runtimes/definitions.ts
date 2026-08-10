import type { AgentRuntime } from './contract.js';
import { createOpenClawAgentRuntime } from './adapters/openclaw/index.js';
import { createCodexAgentRuntime } from './adapters/codex/index.js';
import { createOpenCodeAgentRuntime } from './adapters/opencode/index.js';
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
  codex: {
    id: 'codex',
    createRuntime: createCodexAgentRuntime,
  },
  opencode: {
    id: 'opencode',
    createRuntime: createOpenCodeAgentRuntime,
  },
} satisfies Record<SupportedAgentRuntimeId, AgentRuntimeDefinition>;
