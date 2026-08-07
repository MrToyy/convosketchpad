import {
  AGENT_RUNTIME_MANIFEST,
  type SupportedAgentRuntimeId,
} from '../../../server/lib/agent-runtimes/manifest.js';
import type { EnvConfig } from '../env-writer.js';
import { openClawSetupDriver } from './openclaw/setup-driver.js';
import { codexSetupDriver } from './codex/setup-driver.js';
import type { RuntimeSetupDetection, RuntimeSetupDriver } from './types.js';

const drivers = {
  openclaw: openClawSetupDriver,
  codex: codexSetupDriver,
} satisfies Record<SupportedAgentRuntimeId, RuntimeSetupDriver>;

export function detectAgentRuntimes(existing: EnvConfig): RuntimeSetupDetection[] {
  const configured = new Set((existing.AGENT_RUNTIMES || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean));
  return AGENT_RUNTIME_MANIFEST.map((runtime) => {
    const driver = drivers[runtime.id];
    const configuredExecutable = driver.executableEnvKey
      ? existing[driver.executableEnvKey]
      : undefined;
    return driver.detect({
      configured: configured.has(runtime.id),
      ...(configuredExecutable ? { configuredExecutable } : {}),
    });
  });
}

export function agentRuntimeSetupDriver(runtimeId: SupportedAgentRuntimeId): RuntimeSetupDriver {
  return drivers[runtimeId];
}

export function selectedAgentRuntimeSetupDrivers(
  runtimeIds: SupportedAgentRuntimeId[],
): RuntimeSetupDriver[] {
  return runtimeIds.map((runtimeId) => drivers[runtimeId]);
}

export function groupRuntimeDetections(detections: RuntimeSetupDetection[]): {
  detected: RuntimeSetupDetection[];
  undetected: RuntimeSetupDetection[];
} {
  return {
    detected: detections.filter((runtime) => runtime.detected),
    undetected: detections.filter((runtime) => !runtime.detected),
  };
}

export type { RuntimeSetupDetection, RuntimeSetupDriver } from './types.js';
