import { describe, expect, it, vi } from 'vitest';
import type { AgentBackend, AgentProfile, BackendStatus } from './contract.js';
import {
  aggregateBackendStatuses,
  listAgentCatalog,
  publicAggregatedBackendStatus,
} from './catalog.js';
import { AgentBackendRegistry } from './registry.js';

function catalogBackend(input: {
  id: string;
  status: () => BackendStatus;
  profiles: (ownerId: string) => AgentProfile[] | Promise<AgentProfile[]>;
  defaultProfileId?: string;
}): AgentBackend {
  return {
    id: input.id,
    describe: vi.fn(async () => ({ id: input.id, displayName: `${input.id} Backend` })),
    getStatus: input.status,
    listAgentProfiles: vi.fn(async ({ ownerId }) => ({
      defaultProfileId: input.defaultProfileId,
      profiles: await input.profiles(ownerId),
    })),
    close: vi.fn(),
  } as unknown as AgentBackend;
}

function profile(backendId: string, profileId: string): AgentProfile {
  return {
    backendId,
    profileId,
    displayName: profileId,
    backendProfileRef: {
      backendId,
      schemaVersion: 1,
      opaque: { profileId },
    },
  };
}

describe('Agent Backend catalog aggregation', () => {
  it('keeps configured Backend order and puts each Backend default first', async () => {
    const registry = new AgentBackendRegistry();
    registry.register(catalogBackend({
      id: 'catalog-a',
      status: () => ({ backendId: 'catalog-a', state: 'connected' }),
      profiles: () => [profile('catalog-a', 'secondary'), profile('catalog-a', 'default')],
      defaultProfileId: 'default',
    }));
    registry.register(catalogBackend({
      id: 'catalog-b',
      status: () => ({ backendId: 'catalog-b', state: 'connected' }),
      profiles: () => [profile('catalog-b', 'only')],
    }));

    const catalog = await listAgentCatalog(registry, { ownerId: 'owner-a' });
    expect(catalog.agents.map(({ backendId, profileId }) => `${backendId}/${profileId}`)).toEqual([
      'catalog-a/default',
      'catalog-a/secondary',
      'catalog-b/only',
    ]);
    expect(catalog.firstAvailable).toEqual({ backendId: 'catalog-a', profileId: 'default' });
  });

  it('uses last-known profiles only for the same owner when a Backend disconnects', async () => {
    const registry = new AgentBackendRegistry();
    let state: BackendStatus['state'] = 'connected';
    registry.register(catalogBackend({
      id: 'owner-scoped-cache',
      status: () => ({ backendId: 'owner-scoped-cache', state }),
      profiles: (ownerId) => [profile('owner-scoped-cache', `${ownerId}-private`) ],
    }));

    await listAgentCatalog(registry, { ownerId: 'owner-a' });
    state = 'disconnected';

    const cached = await listAgentCatalog(registry, { ownerId: 'owner-a' });
    expect(cached.agents).toMatchObject([{
      profileId: 'owner-a-private',
      available: false,
    }]);

    const otherOwner = await listAgentCatalog(registry, { ownerId: 'owner-b' });
    expect(otherOwner.agents).toEqual([]);
  });

  it('summarizes partial connectivity without hiding individual states', () => {
    const aggregate = aggregateBackendStatuses([
      { backendId: 'a', state: 'connected' },
      { backendId: 'b', state: 'disconnected' },
    ]);
    expect(aggregate).toMatchObject({
      overallState: 'degraded',
      backends: [
        { backendId: 'a', state: 'connected' },
        { backendId: 'b', state: 'disconnected' },
      ],
    });
  });

  it('does not expose Adapter diagnostics in public runtime status', () => {
    const aggregate = publicAggregatedBackendStatus([{
      backendId: 'a',
      state: 'connected',
      version: '1.0.0',
      restartSupported: true,
      diagnostics: { nativeMethods: ['secret.native.method'] },
    }]);
    expect(aggregate.backends).toEqual([{
      backendId: 'a',
      state: 'connected',
      version: '1.0.0',
      restartSupported: true,
    }]);
  });
});
