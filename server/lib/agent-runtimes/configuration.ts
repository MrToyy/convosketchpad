import { validateOpenClawConfig } from './adapters/openclaw/config.js';
import {
  AGENT_RUNTIME_MANIFEST,
  type SupportedAgentRuntimeId,
} from './manifest.js';

const configValidators = {
  openclaw: validateOpenClawConfig,
} satisfies Record<SupportedAgentRuntimeId, () => { warnings: string[]; errors: string[] }>;

export const SUPPORTED_AGENT_RUNTIMES = Object.freeze(
  AGENT_RUNTIME_MANIFEST.map((runtime) => runtime.id),
);

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
  const supported = new Set<string>(SUPPORTED_AGENT_RUNTIMES);
  const unsupported = unique.filter((entry) => !supported.has(entry));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported Agent Runtime(s): ${unsupported.join(', ')}`);
  }
  if (unique.length === 0) throw new Error('AGENT_RUNTIMES must configure at least one Runtime');
  return unique as SupportedAgentRuntimeId[];
}

export function validateConfiguredAgentRuntimes(
  value = process.env.AGENT_RUNTIMES,
): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  let ids: SupportedAgentRuntimeId[];
  try {
    ids = configuredAgentRuntimeIds(value);
  } catch (error) {
    return { warnings, errors: [error instanceof Error ? error.message : String(error)] };
  }
  for (const id of ids) {
    const result = configValidators[id]();
    warnings.push(...result.warnings.map((message) => `[${id}] ${message}`));
    errors.push(...result.errors.map((message) => `[${id}] ${message}`));
  }
  return { warnings, errors };
}
