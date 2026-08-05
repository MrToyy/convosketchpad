import { describe, expect, it, vi } from 'vitest';
import { assertDatabaseMigrationOffline } from './migration-maintenance.js';
import type { ServiceManager, ServiceState } from './updater/types.js';

function manager(state: ServiceState): ServiceManager {
  return {
    name: 'systemd',
    detect: vi.fn(() => true),
    stop: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    status: vi.fn(async () => state),
    getLogs: vi.fn(async () => ''),
  };
}

describe('standalone database migration maintenance guard', () => {
  it('allows a matching service only when it is confirmed inactive', async () => {
    await expect(assertDatabaseMigrationOffline('/project', false, () => manager('inactive')))
      .resolves.toBeUndefined();
    await expect(assertDatabaseMigrationOffline('/project', true, () => manager('active')))
      .rejects.toThrow(/is active/);
    await expect(assertDatabaseMigrationOffline('/project', true, () => manager('unknown')))
      .rejects.toThrow(/refusing database migration/);
  });

  it('requires explicit offline confirmation when no matching manager exists', async () => {
    await expect(assertDatabaseMigrationOffline('/project', false, () => null))
      .rejects.toThrow(/--confirm-offline/);
    await expect(assertDatabaseMigrationOffline('/project', true, () => null))
      .resolves.toBeUndefined();
  });
});
