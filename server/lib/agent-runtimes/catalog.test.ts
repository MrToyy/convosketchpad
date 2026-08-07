import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRuntime, AgentProfile, RuntimeStatus } from './contract.js';
import {
  aggregateRuntimeStatuses,
  listAgentCatalog,
  publicAggregatedRuntimeStatus,
} from './catalog.js';
import { AgentRuntimeRegistry } from './registry.js';

function catalogRuntime(input: {
  id: string;
  status: () => RuntimeStatus;
  profiles: (ownerId: string) => AgentProfile[] | Promise<AgentProfile[]>;
  defaultProfileId?: string;
}): AgentRuntime {
  return {
    id: input.id,
    describe: vi.fn(async () => ({ id: input.id, displayName: `${input.id} Runtime` })),
    getStatus: input.status,
    listAgentProfiles: vi.fn(async ({ ownerId }) => ({
      defaultProfileId: input.defaultProfileId,
      profiles: await input.profiles(ownerId),
    })),
    close: vi.fn(),
  } as unknown as AgentRuntime;
}

function profile(runtimeId: string, profileId: string): AgentProfile {
  return {
    runtimeId,
    profileId,
    displayName: profileId,
    runtimeProfileRef: {
      runtimeId,
      schemaVersion: 1,
      opaque: { profileId },
    },
  };
}

describe('Agent Runtime catalog aggregation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps configured Runtime order and puts each Runtime default first', async () => {
    const registry = new AgentRuntimeRegistry();
    registry.register(catalogRuntime({
      id: 'catalog-a',
      status: () => ({ runtimeId: 'catalog-a', state: 'connected' }),
      profiles: () => [profile('catalog-a', 'secondary'), profile('catalog-a', 'default')],
      defaultProfileId: 'default',
    }));
    registry.register(catalogRuntime({
      id: 'catalog-b',
      status: () => ({ runtimeId: 'catalog-b', state: 'connected' }),
      profiles: () => [profile('catalog-b', 'only')],
    }));

    const catalog = await listAgentCatalog(registry, { ownerId: 'owner-a' });
    expect(catalog.agents.map(({ runtimeId, profileId }) => `${runtimeId}/${profileId}`)).toEqual([
      'catalog-a/default',
      'catalog-a/secondary',
      'catalog-b/only',
    ]);
    expect(catalog.firstAvailable).toEqual({ runtimeId: 'catalog-a', profileId: 'default' });
  });

  it('uses last-known profiles only for the same owner when a Runtime disconnects', async () => {
    const registry = new AgentRuntimeRegistry();
    let state: RuntimeStatus['state'] = 'connected';
    registry.register(catalogRuntime({
      id: 'owner-scoped-cache',
      status: () => ({ runtimeId: 'owner-scoped-cache', state }),
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

  it('uses the configured default Agent when it is available', async () => {
    vi.stubEnv('CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME', 'catalog-b');
    vi.stubEnv('CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE', 'preferred');
    const registry = new AgentRuntimeRegistry();
    registry.register(catalogRuntime({
      id: 'catalog-a',
      status: () => ({ runtimeId: 'catalog-a', state: 'connected' }),
      profiles: () => [profile('catalog-a', 'first')],
    }));
    registry.register(catalogRuntime({
      id: 'catalog-b',
      status: () => ({ runtimeId: 'catalog-b', state: 'connected' }),
      profiles: () => [profile('catalog-b', 'preferred')],
    }));

    const catalog = await listAgentCatalog(registry, { ownerId: 'owner-a' });
    expect(catalog.firstAvailable).toEqual({ runtimeId: 'catalog-b', profileId: 'preferred' });
  });

  it('summarizes partial connectivity without hiding individual states', () => {
    const aggregate = aggregateRuntimeStatuses([
      { runtimeId: 'a', state: 'connected' },
      { runtimeId: 'b', state: 'disconnected' },
    ]);
    expect(aggregate).toMatchObject({
      overallState: 'degraded',
      runtimes: [
        { runtimeId: 'a', state: 'connected' },
        { runtimeId: 'b', state: 'disconnected' },
      ],
    });
  });

  it('does not expose Adapter diagnostics in public runtime status', () => {
    const aggregate = publicAggregatedRuntimeStatus([{
      runtimeId: 'a',
      state: 'connected',
      version: '1.0.0',
      restartSupported: true,
      diagnostics: { nativeMethods: ['secret.native.method'] },
    }]);
    expect(aggregate.runtimes).toEqual([{
      runtimeId: 'a',
      state: 'connected',
      version: '1.0.0',
      restartSupported: true,
    }]);
  });
});
