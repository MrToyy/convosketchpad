/** Pure Runtime metadata shared by production registration and the setup wizard. */

export const AGENT_RUNTIME_MANIFEST = [
  { id: 'openclaw', displayName: 'OpenClaw' },
] as const;

export type SupportedAgentRuntimeId = typeof AGENT_RUNTIME_MANIFEST[number]['id'];
