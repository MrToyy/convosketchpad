/** Legacy v0.3.x environment keys and their stable Agent Runtime replacements. */
export const LEGACY_RUNTIME_ENV_MAPPINGS = [
  ['AGENT_BACKENDS', 'AGENT_RUNTIMES'],
  ['GATEWAY_URL', 'OPENCLAW_GATEWAY_URL'],
  ['GATEWAY_TOKEN', 'OPENCLAW_GATEWAY_TOKEN'],
  ['CONVOSKETCHPAD_GATEWAY_TIMEZONE', 'OPENCLAW_GATEWAY_TIMEZONE'],
] as const;
