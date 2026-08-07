import { detectServiceManager } from './updater/service-manager.js';
import type { ServiceManager } from './updater/types.js';

export async function assertDatabaseMigrationOffline(
  projectRoot: string,
  confirmOffline: boolean,
  detect: (cwd: string) => ServiceManager | null = detectServiceManager,
): Promise<void> {
  const serviceManager = detect(projectRoot);
  if (!serviceManager) {
    if (confirmOffline) return;
    throw new Error('No matching managed service was found; stop all ConvoSketchpad processes and rerun with --confirm-offline');
  }

  const state = await serviceManager.status();
  if (state === 'active') {
    throw new Error(`ConvoSketchpad is active via ${serviceManager.name}; stop it before running database migration`);
  }
  if (state === 'unknown') {
    throw new Error(`Could not determine ${serviceManager.name} service state; refusing database migration`);
  }
}
