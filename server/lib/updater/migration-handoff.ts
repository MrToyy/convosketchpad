import {
  validateInheritedLease,
  validateLegacyMaintenanceHandoff,
  type MaintenanceLease,
} from './lock.js';

export interface MigrationMaintenanceHandoff {
  protocol: 'current' | 'v0.4.1' | null;
  inherited: boolean;
  databaseOffline: boolean;
  lease: MaintenanceLease | null;
}

/** Resolve an updater-to-migration handoff without trusting flags by themselves. */
export function resolveMigrationMaintenanceHandoff(
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
  expectedParentPid: number = process.ppid,
): MigrationMaintenanceHandoff {
  const token = environment.CONVOSKETCHPAD_MAINTENANCE_LEASE;
  if (token) {
    const lease = validateInheritedLease(
      cwd,
      token,
      expectedParentPid,
      environment.CONVOSKETCHPAD_MAINTENANCE_LEASE_PATH,
    );
    return {
      protocol: 'current',
      inherited: true,
      databaseOffline: environment.CONVOSKETCHPAD_DATABASE_OFFLINE_LEASE === lease.token,
      lease,
    };
  }

  if (environment.CONVOSKETCHPAD_MAINTENANCE_LOCK_HELD === '1') {
    validateLegacyMaintenanceHandoff(cwd, expectedParentPid);
    return {
      protocol: 'v0.4.1',
      inherited: true,
      databaseOffline: environment.CONVOSKETCHPAD_DATABASE_OFFLINE === '1',
      lease: null,
    };
  }

  return {
    protocol: null,
    inherited: false,
    databaseOffline: false,
    lease: null,
  };
}
