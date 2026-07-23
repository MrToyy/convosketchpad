import path from 'node:path';
import { config } from './config.js';
import { buildDefaultAgentWorkspacePath, getConfiguredAgentWorkspace } from './openclaw-config.js';

export interface AgentWorkspace {
  agentId: string;
  workspaceRoot: string;
}

const AGENT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export class InvalidAgentIdError extends Error {
  constructor(agentId: string) {
    super(`Invalid agent id: ${agentId}`);
    this.name = 'InvalidAgentIdError';
  }
}

export function normalizeAgentId(agentId?: string): string {
  const normalized = (agentId || '').trim();
  if (!normalized) return 'main';
  if (normalized === 'main') return 'main';
  if (!AGENT_ID_PATTERN.test(normalized)) {
    throw new InvalidAgentIdError(normalized);
  }
  return normalized;
}

export function resolveAgentWorkspace(agentId?: string): AgentWorkspace {
  const normalizedAgentId = normalizeAgentId(agentId);

  if (normalizedAgentId === 'main') {
    return { agentId: 'main', workspaceRoot: path.resolve(config.workspaceRoot) };
  }

  const workspaceRoot = getConfiguredAgentWorkspace(normalizedAgentId)
    || buildDefaultAgentWorkspacePath(normalizedAgentId);
  return { agentId: normalizedAgentId, workspaceRoot };
}
