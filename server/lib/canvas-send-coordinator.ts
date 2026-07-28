import { subscribeGatewayEvents, subscribeGatewayStatus } from './gateway-rpc.js';
import {
  getCanvasStore,
  type InteractionRecord,
  type SendReservation,
} from './canvas-db.js';
import { rescanCanvasReconciliationCandidates } from './canvas-reconciler.js';
import { canvasSendRetryWakeAt } from './canvas-send-retry.js';
import { publishRuntimeEvent } from './runtime-events.js';
import {
  canvasSendWorkerHasActiveDispatches,
  canvasSendWorkerIsActive,
  clearCanvasSendWorkerState,
  consumeCanvasGatewayEvent,
  runCanvasSendWorker,
} from './canvas-send-worker.js';

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimerAt: number | null = null;
let retryScanRunning = false;
let retryScanRequested = false;
let started = false;
let unsubscribeEvents: (() => void) | null = null;
let unsubscribeStatus: (() => void) | null = null;

export async function dispatchCanvasSend(reservationId: string): Promise<SendReservation | InteractionRecord> {
  try {
    return await runCanvasSendWorker(reservationId);
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
    const due = getCanvasStore().listDispatchableReservations()
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
  const nextAttemptAt = getCanvasStore().nextDispatchableReservationAt();
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

export function startCanvasSendCoordinator(): void {
  if (started) return;
  started = true;
  unsubscribeEvents = subscribeGatewayEvents(consumeCanvasGatewayEvent);
  unsubscribeStatus = subscribeGatewayStatus((status) => {
    publishRuntimeEvent({ type: 'runtime.connection_changed', payload: { ...status } });
    if (status.state === 'connected') {
      rescanCanvasReconciliationCandidates();
      void retryDueSends();
    }
  });
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
  unsubscribeEvents?.();
  unsubscribeStatus?.();
  unsubscribeEvents = null;
  unsubscribeStatus = null;
}
