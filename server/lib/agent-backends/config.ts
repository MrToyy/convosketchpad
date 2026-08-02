export const SUPPORTED_AGENT_BACKENDS = ['openclaw'] as const;
export type SupportedAgentBackendId = typeof SUPPORTED_AGENT_BACKENDS[number];

export function configuredAgentBackendIds(
  value = process.env.AGENT_BACKENDS,
): SupportedAgentBackendId[] {
  const requested = (value === undefined ? 'openclaw' : value)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(requested)];
  if (unique.length !== requested.length) {
    throw new Error('AGENT_BACKENDS must not configure the same Backend more than once');
  }
  const unsupported = unique.filter((entry) => !SUPPORTED_AGENT_BACKENDS.includes(entry as SupportedAgentBackendId));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported Agent Backend(s): ${unsupported.join(', ')}`);
  }
  if (unique.length === 0) throw new Error('AGENT_BACKENDS must configure at least one Backend');
  return unique as SupportedAgentBackendId[];
}
