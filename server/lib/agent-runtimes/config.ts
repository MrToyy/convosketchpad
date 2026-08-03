export const SUPPORTED_AGENT_RUNTIMES = ['openclaw'] as const;
export type SupportedAgentRuntimeId = typeof SUPPORTED_AGENT_RUNTIMES[number];

export function configuredAgentRuntimeIds(
  value = process.env.AGENT_RUNTIMES,
): SupportedAgentRuntimeId[] {
  const requested = (value === undefined ? 'openclaw' : value)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(requested)];
  if (unique.length !== requested.length) {
    throw new Error('AGENT_RUNTIMES must not configure the same Runtime more than once');
  }
  const unsupported = unique.filter((entry) => !SUPPORTED_AGENT_RUNTIMES.includes(entry as SupportedAgentRuntimeId));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported Agent Runtime(s): ${unsupported.join(', ')}`);
  }
  if (unique.length === 0) throw new Error('AGENT_RUNTIMES must configure at least one Runtime');
  return unique as SupportedAgentRuntimeId[];
}
