import { checkbox, select } from '@inquirer/prompts';
import type { SupportedAgentRuntimeId } from '../../server/lib/agent-runtimes/manifest.js';
import { AGENT_RUNTIME_MANIFEST } from '../../server/lib/agent-runtimes/manifest.js';
import { dim, fail, promptTheme, section, success, warn } from './banner.js';
import type { EnvConfig } from './env-writer.js';
import { groupRuntimeDetections, type RuntimeSetupDetection } from './agent-runtimes/setup-registry.js';
import { probeConfiguredAgents } from './agent-runtimes/catalog-probe.js';
import { parseDefaultAgentRef } from './setup-cli-options.js';

const TOTAL_SECTIONS = 5;

export function existingRuntimeIds(existing: EnvConfig): SupportedAgentRuntimeId[] {
  const supported = new Set<string>(AGENT_RUNTIME_MANIFEST.map((runtime) => runtime.id));
  return (existing.AGENT_RUNTIMES || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((id): id is SupportedAgentRuntimeId => supported.has(id));
}

export async function chooseAgentRuntimes(input: {
  detections: RuntimeSetupDetection[];
  existing: EnvConfig;
  interactive: boolean;
  requestedRuntimeIds: SupportedAgentRuntimeId[] | null;
}): Promise<SupportedAgentRuntimeId[]> {
  if (input.requestedRuntimeIds) return input.requestedRuntimeIds;
  const configured = existingRuntimeIds(input.existing);
  if (!input.interactive) {
    if (configured.length > 0) return configured;
    const detected = input.detections.filter((runtime) => runtime.detected).map((runtime) => runtime.runtimeId);
    return detected.length > 0 ? detected : ['openclaw'];
  }

  section(1, TOTAL_SECTIONS, 'Agent Runtime discovery');
  const groups = groupRuntimeDetections(input.detections);
  const configuredSet = new Set(configured);
  const fresh = configured.length === 0;
  for (const runtime of groups.detected) success(`${runtime.displayName}: ${runtime.message}`);
  for (const runtime of groups.undetected) warn(`${runtime.displayName}: ${runtime.message}`);
  console.log('');

  while (true) {
    const selectedDetected = groups.detected.length > 0
      ? await checkbox<SupportedAgentRuntimeId>({
          theme: promptTheme,
          message: 'Detected Runtimes to connect',
          choices: groups.detected.map((runtime) => ({
            name: runtime.displayName,
            value: runtime.runtimeId,
            checked: configuredSet.has(runtime.runtimeId) || fresh,
          })),
        })
      : [];
    const selectedUndetected = groups.undetected.length > 0
      ? await checkbox<SupportedAgentRuntimeId>({
          theme: promptTheme,
          message: 'Other supported Runtimes to configure manually',
          choices: groups.undetected.map((runtime) => ({
            name: `${runtime.displayName} (not detected locally)`,
            value: runtime.runtimeId,
            checked: configuredSet.has(runtime.runtimeId),
          })),
        })
      : [];
    const selected = [...selectedDetected, ...selectedUndetected];
    if (selected.length > 0) return selected;
    warn('Select at least one Agent Runtime. A remote Runtime may be configured even when its CLI is not detected locally.');
  }
}

export async function configureDefaultAgent(input: {
  config: EnvConfig;
  selectedRuntimeIds: SupportedAgentRuntimeId[];
  interactive: boolean;
  requestedDefaultAgent: { runtimeId: string; profileId: string } | null;
}): Promise<void> {
  const { config, selectedRuntimeIds, interactive, requestedDefaultAgent } = input;
  if (requestedDefaultAgent && !selectedRuntimeIds.includes(requestedDefaultAgent.runtimeId as SupportedAgentRuntimeId)) {
    fail(`Default Agent Runtime ${requestedDefaultAgent.runtimeId} is not selected by AGENT_RUNTIMES.`);
    process.exit(1);
  }

  if (interactive) {
    section(5, TOTAL_SECTIONS, 'Default Agent');
    dim('New canvases start with this Agent selected; it can still be changed before the first send.');
  }

  process.stdout.write('  Loading available Agents... ');
  const { candidates, warnings } = await probeConfiguredAgents(config);
  console.log(candidates.length > 0
    ? `\x1b[32m✓\x1b[0m ${candidates.length} found`
    : '\x1b[33m!\x1b[0m none available');
  for (const message of warnings) dim(`  ${message}`);

  let selected = requestedDefaultAgent;
  if (selected) {
    const matched = candidates.some((candidate) =>
      candidate.runtimeId === selected!.runtimeId && candidate.profileId === selected!.profileId);
    if (candidates.length > 0 && !matched) {
      fail(`--default-agent ${selected.runtimeId}/${selected.profileId} was not returned by the configured Runtimes.`);
      process.exit(1);
    }
  } else if (candidates.length > 0 && interactive) {
    const existingValue = config.CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME
      && config.CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE
      ? `${config.CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME}/${config.CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE}`
      : undefined;
    const availableValues = new Set(candidates.map((candidate) => `${candidate.runtimeId}/${candidate.profileId}`));
    const value = await select({
      theme: promptTheme,
      message: 'Default Agent',
      choices: candidates.map((candidate) => ({
        name: `${candidate.displayName} — ${candidate.runtimeDisplayName}`,
        value: `${candidate.runtimeId}/${candidate.profileId}`,
      })),
      default: existingValue && availableValues.has(existingValue) ? existingValue : undefined,
    });
    selected = parseDefaultAgentRef(value);
  } else if (candidates.length > 0) {
    const existing = candidates.find((candidate) =>
      candidate.runtimeId === config.CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME
      && candidate.profileId === config.CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE);
    selected = existing || candidates[0];
  } else if (
    config.CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME
    && config.CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE
    && selectedRuntimeIds.includes(config.CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME as SupportedAgentRuntimeId)
  ) {
    selected = {
      runtimeId: config.CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME,
      profileId: config.CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE,
    };
    warn('Agent catalog could not be loaded; preserving the existing default Agent.');
  } else {
    delete config.CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME;
    delete config.CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE;
    warn('Agent catalog could not be loaded; no explicit default was saved. Canvas will use the first available Agent.');
    return;
  }

  if (!selected) throw new Error('Default Agent selection was empty');
  config.CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME = selected.runtimeId;
  config.CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE = selected.profileId;
  success(`Default Agent: ${selected.runtimeId}/${selected.profileId}`);
}
