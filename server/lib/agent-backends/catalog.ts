import type {
  AgentProfile,
  AgentProfileRef,
  BackendStatus,
  OwnerContext,
} from './contract.js';
import type { AgentBackendRegistry } from './registry.js';

const lastKnownProfiles = new Map<string, AgentProfile[]>();

function profileCacheKey(backendId: string, ownerId: string): string {
  return `${backendId}\0${ownerId}`;
}

export interface AgentCatalogEntry extends AgentProfile {
  backendDisplayName: string;
  available: boolean;
  unavailableReason?: string;
}

export interface AgentCatalog {
  agents: AgentCatalogEntry[];
  firstAvailable: AgentProfileRef | null;
}

export type OverallBackendState = 'ready' | 'degraded' | 'connecting' | 'unavailable';

export interface AggregatedBackendStatus {
  overallState: OverallBackendState;
  backends: BackendStatus[];
  updatedAt: number;
}

export interface PublicBackendStatus {
  backendId: string;
  state: BackendStatus['state'];
  error?: string;
  version?: string;
  restartSupported?: boolean;
}

export interface PublicAggregatedBackendStatus extends Omit<AggregatedBackendStatus, 'backends'> {
  backends: PublicBackendStatus[];
}

export function aggregateBackendStatuses(backends: BackendStatus[]): AggregatedBackendStatus {
  const connected = backends.filter((status) => status.state === 'connected').length;
  const connecting = backends.filter((status) => status.state === 'connecting').length;
  const overallState: OverallBackendState = connected === backends.length && connected > 0
    ? 'ready'
    : connected > 0
      ? 'degraded'
      : connecting > 0
        ? 'connecting'
        : 'unavailable';
  return { overallState, backends, updatedAt: Date.now() };
}

/** Strip protocol diagnostics and capabilities before a runtime status reaches the browser. */
export function publicAggregatedBackendStatus(
  backends: BackendStatus[],
): PublicAggregatedBackendStatus {
  const aggregate = aggregateBackendStatuses(backends);
  return {
    ...aggregate,
    backends: aggregate.backends.map((status) => ({
      backendId: status.backendId,
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
  registry: AgentBackendRegistry,
  owner: OwnerContext,
): Promise<AgentCatalog> {
  const groups = await Promise.all(registry.list().map(async (backend) => {
    const cacheKey = profileCacheKey(backend.id, owner.ownerId);
    const status = backend.getStatus();
    let backendDisplayName = backend.id;
    try {
      backendDisplayName = (await backend.describe()).displayName;
    } catch {
      // A descriptor failure must not hide healthy agents from other Backends.
    }
    if (status.state !== 'connected') {
      return {
        entries: (lastKnownProfiles.get(cacheKey) || []).map((profile) => ({
          ...profile,
          backendDisplayName,
          available: false,
          unavailableReason: status.error || 'Backend unavailable',
        })),
        backendDisplayName,
        status,
      };
    }
    try {
      const catalog = await backend.listAgentProfiles(owner);
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
          backendDisplayName,
          available: true,
        })),
        backendDisplayName,
        status,
      };
    } catch (error) {
      return {
        entries: (lastKnownProfiles.get(cacheKey) || []).map((profile) => ({
          ...profile,
          backendDisplayName,
          available: false,
          unavailableReason: error instanceof Error ? error.message : 'Agent catalog unavailable',
        })),
        backendDisplayName,
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
    firstAvailable: first ? { backendId: first.backendId, profileId: first.profileId } : null,
  };
}
