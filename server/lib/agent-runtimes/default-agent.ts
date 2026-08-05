import type { AgentProfileRef } from './contract.js';

export interface DefaultAgentConfiguration {
  ref: AgentProfileRef | null;
  error?: string;
}

export function configuredDefaultAgent(
  environment: NodeJS.ProcessEnv = process.env,
): DefaultAgentConfiguration {
  const runtimeId = environment.CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME?.trim().toLowerCase() || '';
  const profileId = environment.CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE?.trim() || '';
  if (!runtimeId && !profileId) return { ref: null };
  if (!runtimeId || !profileId) {
    return {
      ref: null,
      error: 'CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME and CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE must be configured together',
    };
  }
  return { ref: { runtimeId, profileId } };
}
