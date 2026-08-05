import type { AgentProfileRef, RuntimeStatus } from '../../../server/lib/agent-runtimes/contract.js';
import type { EnvConfig } from '../env-writer.js';

export interface SetupAgentCandidate extends AgentProfileRef {
  displayName: string;
  runtimeDisplayName: string;
}

function applyRuntimeEnvironment(config: EnvConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) process.env[key] = value;
  }
}

function waitForConnected(
  getStatus: () => RuntimeStatus,
  subscribe: (listener: (status: RuntimeStatus) => void) => () => void,
  timeoutMs: number,
): Promise<boolean> {
  if (getStatus().state === 'connected') return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (connected: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(connected);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const subscribed = subscribe((status) => {
      if (status.state === 'connected') finish(true);
    });
    unsubscribe = subscribed;
    if (settled) subscribed();
  });
}

/** Probe Agent profiles through the same protocol-neutral Runtime Port used by Canvas. */
export async function probeConfiguredAgents(
  config: EnvConfig,
  timeoutMs = 8_000,
): Promise<{ candidates: SetupAgentCandidate[]; warnings: string[] }> {
  applyRuntimeEnvironment(config);
  const { createConfiguredAgentRuntimeRegistry } = await import('../../../server/lib/agent-runtimes/registry.js');
  const agentRuntimeRegistry = createConfiguredAgentRuntimeRegistry();
  try {
    const groups = await Promise.all(agentRuntimeRegistry.list().map(async (runtime) => {
      const connected = await waitForConnected(
        () => runtime.getStatus(),
        (listener) => runtime.subscribeStatus(listener),
        timeoutMs,
      );
      if (!connected) {
        return {
          candidates: [],
          warnings: [`${runtime.id}: ${runtime.getStatus().error || 'connection timed out'}`],
        };
      }
      try {
        const [descriptor, catalog] = await Promise.all([
          runtime.describe(),
          runtime.listAgentProfiles({ ownerId: 'setup' }),
        ]);
        const ordered = catalog.defaultProfileId
          ? [
              ...catalog.profiles.filter((profile) => profile.profileId === catalog.defaultProfileId),
              ...catalog.profiles.filter((profile) => profile.profileId !== catalog.defaultProfileId),
            ]
          : catalog.profiles;
        return {
          candidates: ordered.map((profile) => ({
            runtimeId: profile.runtimeId,
            profileId: profile.profileId,
            displayName: profile.displayName,
            runtimeDisplayName: descriptor.displayName,
          })),
          warnings: [],
        };
      } catch (error) {
        return {
          candidates: [],
          warnings: [`${runtime.id}: ${error instanceof Error ? error.message : String(error)}`],
        };
      }
    }));
    return {
      candidates: groups.flatMap((group) => group.candidates),
      warnings: groups.flatMap((group) => group.warnings),
    };
  } finally {
    agentRuntimeRegistry.close();
  }
}
