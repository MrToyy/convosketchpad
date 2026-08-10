/** Pure Runtime metadata shared by production registration and the setup wizard. */

export const AGENT_RUNTIME_MANIFEST = [
  { id: 'openclaw', displayName: 'OpenClaw' },
  { id: 'codex', displayName: 'Codex' },
  { id: 'opencode', displayName: 'OpenCode' },
] as const;

export type SupportedAgentRuntimeId = typeof AGENT_RUNTIME_MANIFEST[number]['id'];
