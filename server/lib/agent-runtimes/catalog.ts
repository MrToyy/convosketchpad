import type {
  AgentProfile,
  AgentProfileRef,
  RuntimeStatus,
  OwnerContext,
} from './contract.js';
import type { AgentRuntimeRegistry } from './registry.js';

const lastKnownProfiles = new Map<string, AgentProfile[]>();

function profileCacheKey(runtimeId: string, ownerId: string): string {
  return `${runtimeId}\0${ownerId}`;
}

export interface AgentCatalogEntry extends AgentProfile {
  runtimeDisplayName: string;
  available: boolean;
  unavailableReason?: string;
}

export interface AgentCatalog {
  agents: AgentCatalogEntry[];
  firstAvailable: AgentProfileRef | null;
}

export type OverallRuntimeState = 'ready' | 'degraded' | 'connecting' | 'unavailable';

export interface AggregatedRuntimeStatus {
  overallState: OverallRuntimeState;
  runtimes: RuntimeStatus[];
  updatedAt: number;
}

export interface PublicRuntimeStatus {
  runtimeId: string;
  state: RuntimeStatus['state'];
  error?: string;
  version?: string;
  restartSupported?: boolean;
}

export interface PublicAggregatedRuntimeStatus extends Omit<AggregatedRuntimeStatus, 'runtimes'> {
  runtimes: PublicRuntimeStatus[];
}

export function aggregateRuntimeStatuses(runtimes: RuntimeStatus[]): AggregatedRuntimeStatus {
  const connected = runtimes.filter((status) => status.state === 'connected').length;
  const connecting = runtimes.filter((status) => status.state === 'connecting').length;
  const overallState: OverallRuntimeState = connected === runtimes.length && connected > 0
    ? 'ready'
    : connected > 0
      ? 'degraded'
      : connecting > 0
        ? 'connecting'
        : 'unavailable';
  return { overallState, runtimes, updatedAt: Date.now() };
}

/** Strip protocol diagnostics and capabilities before a runtime status reaches the browser. */
export function publicAggregatedRuntimeStatus(
  runtimes: RuntimeStatus[],
): PublicAggregatedRuntimeStatus {
  const aggregate = aggregateRuntimeStatuses(runtimes);
  return {
    ...aggregate,
    runtimes: aggregate.runtimes.map((status) => ({
      runtimeId: status.runtimeId,
      state: status.state,
      ...(status.error ? { error: status.error } : {}),
      ...(status.version ? { version: status.version } : {}),
      ...(status.restartSupported !== undefined
        ? { restartSupported: status.restartSupported }
        : {}),
    })),
  };
}

export async function listAgentCatalog(
  registry: AgentRuntimeRegistry,
  owner: OwnerContext,
): Promise<AgentCatalog> {
  const groups = await Promise.all(registry.list().map(async (runtime) => {
    const cacheKey = profileCacheKey(runtime.id, owner.ownerId);
    const status = runtime.getStatus();
    let runtimeDisplayName = runtime.id;
    try {
      runtimeDisplayName = (await runtime.describe()).displayName;
    } catch {
      // A descriptor failure must not hide healthy agents from other Runtimes.
    }
    if (status.state !== 'connected') {
      return {
        entries: (lastKnownProfiles.get(cacheKey) || []).map((profile) => ({
          ...profile,
          runtimeDisplayName,
          available: false,
          unavailableReason: status.error || 'Runtime unavailable',
        })),
        runtimeDisplayName,
        status,
      };
    }
    try {
      const catalog = await runtime.listAgentProfiles(owner);
      const ordered = catalog.defaultProfileId
        ? [
            ...catalog.profiles.filter((profile) => profile.profileId === catalog.defaultProfileId),
            ...catalog.profiles.filter((profile) => profile.profileId !== catalog.defaultProfileId),
          ]
        : catalog.profiles;
      lastKnownProfiles.set(cacheKey, ordered);
      return {
        entries: ordered.map((profile) => ({
          ...profile,
          runtimeDisplayName,
          available: true,
        })),
        runtimeDisplayName,
        status,
      };
    } catch (error) {
      return {
        entries: (lastKnownProfiles.get(cacheKey) || []).map((profile) => ({
          ...profile,
          runtimeDisplayName,
          available: false,
          unavailableReason: error instanceof Error ? error.message : 'Agent catalog unavailable',
        })),
        runtimeDisplayName,
        status: {
          ...status,
          error: error instanceof Error ? error.message : 'Agent catalog unavailable',
        },
      };
    }
  }));
  const agents = groups.flatMap((group) => group.entries);
  const first = agents.find((agent) => agent.available);
  return {
    agents,
    firstAvailable: first ? { runtimeId: first.runtimeId, profileId: first.profileId } : null,
  };
}
