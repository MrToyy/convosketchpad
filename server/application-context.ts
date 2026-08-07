import type { AgentRuntimeRegistry } from './lib/agent-runtimes/registry.js';
import { createConfiguredAgentRuntimeRegistry } from './lib/agent-runtimes/registry.js';
import type { SupportedAgentRuntimeId } from './lib/agent-runtimes/manifest.js';
import { config } from './lib/config.js';
import { startCanvasReconciler, stopCanvasReconciler } from './lib/canvas-reconciler.js';
import { startCanvasSendCoordinator, stopCanvasSendCoordinator } from './lib/canvas-send-coordinator.js';
import { CanvasStore } from './lib/canvas/persistence/canvas-store.js';

export interface ApplicationContext {
  runtimes: AgentRuntimeRegistry;
  store: CanvasStore;
  shutdownSignal: AbortSignal;
  start(): void;
  close(): void;
}

export interface ApplicationContextOptions {
  databasePath?: string;
  runtimeIds?: SupportedAgentRuntimeId[];
}

export function createApplicationContext(options: ApplicationContextOptions = {}): ApplicationContext {
  const shutdownController = new AbortController();
  const runtimes = createConfiguredAgentRuntimeRegistry(options.runtimeIds);
  const store = new CanvasStore(options.databasePath || config.canvasDatabasePath, {
    createConversationHandle: (input) =>
      runtimes.get(input.profile.runtimeId).createConversationHandle(input),
  });
  let started = false;
  let closed = false;
  return {
    runtimes,
    store,
    shutdownSignal: shutdownController.signal,
    start() {
      if (closed) throw new Error('Application context is closed');
      if (started) return;
      startCanvasReconciler(store, (runtimeId) => runtimes.get(runtimeId));
      try {
        startCanvasSendCoordinator(runtimes, store);
        started = true;
      } catch (error) {
        stopCanvasReconciler();
        throw error;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      shutdownController.abort();
      if (started) {
        stopCanvasSendCoordinator();
        stopCanvasReconciler();
      }
      runtimes.close();
      store.close();
    },
  };
}
