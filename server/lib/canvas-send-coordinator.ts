import type { AgentRuntimeRegistry } from './agent-runtimes/registry.js';
import { publicAggregatedRuntimeStatus } from './agent-runtimes/catalog.js';
import type { CanvasStore } from './canvas/persistence/canvas-store.js';
import type { InteractionRecord, SendReservation } from './canvas/model.js';
import { rescanCanvasReconciliationCandidates } from './canvas-reconciler.js';
import { canvasSendRetryWakeAt } from './canvas/domain/send-retry.js';
import { publishRuntimeEvent } from './runtime-status-events.js';
import {
  canvasSendWorkerHasActiveDispatches,
  canvasSendWorkerIsActive,
  clearCanvasSendWorkerState,
  consumeCanvasRuntimeEvent,
  runCanvasSendWorker,
} from './canvas-send-worker.js';

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimerAt: number | null = null;
let retryScanRunning = false;
let retryScanRequested = false;
let started = false;
let unsubscribeRuntimeSubscriptions: Array<() => void> = [];
let runtimeRegistry: AgentRuntimeRegistry | null = null;
let configuredCanvasStore: CanvasStore | null = null;

function runtimes(): AgentRuntimeRegistry {
  if (!runtimeRegistry) throw new Error('Canvas send coordinator is not started');
  return runtimeRegistry;
}

function canvasStore(): CanvasStore {
  if (!configuredCanvasStore) throw new Error('Canvas send coordinator is not started');
  return configuredCanvasStore;
}

function publishRuntimeStatuses(): void {
  publishRuntimeEvent({
    type: 'runtime.status_changed',
    payload: publicAggregatedRuntimeStatus(
      runtimes().list().map((runtime) => runtime.getStatus()),
    ) as unknown as Record<string, unknown>,
  });
}

export async function dispatchCanvasSend(reservationId: string): Promise<SendReservation | InteractionRecord> {
  try {
    return await runCanvasSendWorker(
      reservationId,
      (runtimeId) => runtimes().get(runtimeId),
      canvasStore(),
    );
  } finally {
    scheduleNextRetryScan();
  }
}

async function retryDueSends(): Promise<void> {
  if (!started) return;
  if (retryScanRunning) {
    retryScanRequested = true;
    return;
  }
  retryScanRunning = true;
  retryScanRequested = false;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryTimerAt = null;
  try {
    const due = canvasStore().listDispatchableReservations()
      .filter((reservation) => !canvasSendWorkerIsActive(reservation.id));
    await Promise.all(due.map((reservation) => dispatchCanvasSend(reservation.id)));
  } finally {
    retryScanRunning = false;
    if (started) {
      if (retryScanRequested) {
        retryScanRequested = false;
        queueMicrotask(() => void retryDueSends());
      } else {
        scheduleNextRetryScan();
      }
    }
  }
}

function scheduleNextRetryScan(): void {
  if (!started) return;
  const nextAttemptAt = canvasStore().nextDispatchableReservationAt();
  const now = Date.now();
  const effectiveAttemptAt = canvasSendRetryWakeAt(
    nextAttemptAt,
    now,
    canvasSendWorkerHasActiveDispatches(),
  );
  if (effectiveAttemptAt === null) {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    retryTimerAt = null;
    return;
  }
  if (retryTimer && retryTimerAt !== null && retryTimerAt <= effectiveAttemptAt) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimerAt = effectiveAttemptAt;
  const delay = Math.max(0, effectiveAttemptAt - now);
  retryTimer = setTimeout(() => void retryDueSends(), delay);
  retryTimer.unref?.();
}

export function startCanvasSendCoordinator(registry: AgentRuntimeRegistry, store: CanvasStore): void {
  if (started) {
    if (runtimeRegistry === registry && configuredCanvasStore === store) return;
    throw new Error('A Canvas send coordinator is already active in this process');
  }
  started = true;
  runtimeRegistry = registry;
  configuredCanvasStore = store;
  unsubscribeRuntimeSubscriptions = registry.list().flatMap((runtime) => [
    runtime.subscribeEvents((event) => consumeCanvasRuntimeEvent(store, event)),
    runtime.subscribeStatus((status) => {
      publishRuntimeStatuses();
      if (status.state === 'connected') {
        rescanCanvasReconciliationCandidates();
        void retryDueSends();
      }
    }),
  ]);
  publishRuntimeStatuses();
  void retryDueSends();
}

export function stopCanvasSendCoordinator(): void {
  started = false;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryTimerAt = null;
  retryScanRunning = false;
  retryScanRequested = false;
  clearCanvasSendWorkerState();
  for (const unsubscribe of unsubscribeRuntimeSubscriptions) unsubscribe();
  unsubscribeRuntimeSubscriptions = [];
  runtimeRegistry = null;
  configuredCanvasStore = null;
}
