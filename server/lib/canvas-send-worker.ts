import {
  getCanvasStore,
  type InteractionRecord,
  type SendReservation,
} from './canvas-db.js';
import {
  assertCanvasReplayPayloadFits,
  buildCanvasDelivery,
} from './canvas-send-delivery.js';
import { handleCanvasGatewayEvent, registerCanvasInteraction } from './canvas-gateway-events.js';
import { CANVAS_DELIVERY_MAX_BYTES } from './canvas-media-derivatives.js';
import { scheduleCanvasInteractionReconciliation } from './canvas-reconciler.js';
import { canvasSendRetryDelay } from './canvas-send-retry.js';
import { publishCanvasChanged } from './canvas-sync.js';
import {
  GatewayDispatchError,
  type GatewayEvent,
} from './gateway-rpc.js';
import { openClawCanvas } from './openclaw-canvas.js';

const activeDispatches = new Set<string>();

export function canvasSendWorkerIsActive(reservationId: string): boolean {
  return activeDispatches.has(reservationId);
}

export function canvasSendWorkerHasActiveDispatches(): boolean {
  return activeDispatches.size > 0;
}

export function clearCanvasSendWorkerState(): void {
  activeDispatches.clear();
}

export function consumeCanvasGatewayEvent(event: GatewayEvent): void {
  handleCanvasGatewayEvent(event);
}

export async function runCanvasSendWorker(
  reservationId: string,
): Promise<SendReservation | InteractionRecord> {
  if (activeDispatches.has(reservationId)) {
    return getCanvasStore().getReservation(reservationId) || Promise.reject(new Error('not_found'));
  }
  activeDispatches.add(reservationId);
  try {
    const store = getCanvasStore();
    let reservation = store.getDispatchableReservation(reservationId);
    if (!reservation) throw new Error('not_found');
    if (reservation.status === 'acknowledged' && reservation.interactionId) {
      return store.getOwnedInteraction(reservation.ownerId, reservation.interactionId) || reservation;
    }
    if (reservation.status !== 'prepared') return reservation;
    if (openClawCanvas.supports('chat.send') === false) {
      const status = openClawCanvas.runtimeStatus();
      if (status.state === 'connected') {
        store.failReservationById(reservation.id, 'Gateway does not advertise chat.send');
        return store.getReservation(reservation.id)!;
      }
    }

    const requiresMediaPreparation = [
      ...reservation.attachments,
      ...reservation.bootstrapResources,
    ].some((item) => item.mimeType.startsWith('image/')
      && (item.sizeBytes || 0) > CANVAS_DELIVERY_MAX_BYTES);
    if (requiresMediaPreparation) {
      store.markReservationAwaitingMedia(reservation.id);
      reservation = store.getDispatchableReservation(reservation.id)!;
      publishCanvasChanged(reservation.ownerId, reservation.canvasId);
    }
    const { message, attachments, bootstrapWarnings } = await buildCanvasDelivery(reservation);
    const preparedReservation = store.getDispatchableReservation(reservation.id);
    if (!preparedReservation) throw new Error('not_found');
    if (preparedReservation.status !== 'prepared') return preparedReservation;
    store.markReservationDispatching(reservation.id);
    reservation = store.getDispatchableReservation(reservation.id)!;
    const params = {
      sessionKey: reservation.sessionKey,
      message,
      ...(attachments.length ? { attachments } : {}),
      deliver: false,
      idempotencyKey: reservation.id,
    };
    assertCanvasReplayPayloadFits(
      reservation,
      params,
      openClawCanvas.runtimeStatus().maxPayload,
    );
    const raw = await openClawCanvas.send(params, 30_000);
    const runId = typeof raw?.runId === 'string' ? raw.runId : null;
    const interaction = store.acknowledgeSend(
      reservation.ownerId,
      reservation.id,
      runId,
      bootstrapWarnings,
    );
    registerCanvasInteraction(reservation, interaction, runId);
    scheduleCanvasInteractionReconciliation(interaction.id);
    return interaction;
  } catch (error) {
    const store = getCanvasStore();
    const reservation = store.getDispatchableReservation(reservationId);
    if (!reservation) throw error;
    if (!(error instanceof GatewayDispatchError) || error.kind === 'rejected') {
      const message = error instanceof Error ? error.message : 'Send preparation failed';
      store.failReservationById(reservation.id, message);
      console.error(JSON.stringify({
        level: 'error',
        subsystem: 'canvas_send',
        action: 'dispatch_failed',
        canvasId: reservation.canvasId,
        branchId: reservation.branchId,
        sendOperationId: reservationId,
        attempt: reservation.attemptCount,
        error: message,
      }));
      publishCanvasChanged(reservation.ownerId, reservation.canvasId);
    } else {
      const ambiguous = error.kind === 'outcome_unknown';
      const nextAttemptAt = Date.now() + canvasSendRetryDelay(reservation.attemptCount);
      store.scheduleReservationRetry(
        reservation.id,
        ambiguous ? 'ambiguous' : 'reserved',
        error.message,
        nextAttemptAt,
      );
      console.warn(JSON.stringify({
        level: 'warn',
        subsystem: 'canvas_send',
        action: ambiguous ? 'outcome_ambiguous' : 'retry_scheduled',
        canvasId: reservation.canvasId,
        branchId: reservation.branchId,
        sendOperationId: reservationId,
        attempt: reservation.attemptCount,
        nextAttemptAt,
        error: error.name,
      }));
      publishCanvasChanged(reservation.ownerId, reservation.canvasId);
    }
    return store.getReservation(reservationId)!;
  } finally {
    activeDispatches.delete(reservationId);
  }
}
