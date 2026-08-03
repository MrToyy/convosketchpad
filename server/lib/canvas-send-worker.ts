import {
  getCanvasStore,
  type InteractionRecord,
  type SendReservation,
} from './canvas-db.js';
import {
  buildCanvasDelivery,
} from './canvas-send-delivery.js';
import { handleCanvasRuntimeEvent, registerCanvasInteraction } from './canvas/runtime-events.js';
import type { RuntimeEvent } from './agent-runtimes/contract.js';
import { RuntimeOperationError } from './agent-runtimes/contract.js';
import { getAgentRuntime } from './agent-runtimes/registry.js';
import { CANVAS_DELIVERY_MAX_BYTES } from './canvas-media-derivatives.js';
import { scheduleCanvasInteractionReconciliation } from './canvas-reconciler.js';
import { canvasSendRetryDelay } from './canvas-send-retry.js';
import { publishCanvasChanged } from './canvas-sync.js';

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

export function consumeCanvasRuntimeEvent(event: RuntimeEvent): void {
  handleCanvasRuntimeEvent(event);
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
    const runtime = getAgentRuntime(reservation.runtimeId);
    const profile = {
      runtimeId: runtime.id,
      profileId: reservation.agentProfileId,
    };
    const capabilities = await runtime.getCapabilities(profile);
    if (!capabilities.input.text) {
      const status = runtime.getStatus();
      if (status.state === 'connected') {
        store.failReservationById(reservation.id, 'Agent Runtime does not support text input');
        return store.getReservation(reservation.id)!;
      }
    }

    const requiresMediaPreparation = [
      ...reservation.attachments,
      ...reservation.bootstrapResources,
    ].some((item) => item.mimeType?.startsWith('image/')
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
    if (!reservation.conversationRef) throw new RuntimeOperationError('validation', 'Reservation has no conversation reference');
    const dispatched = await runtime.dispatchTurn({
      profile,
      conversationRef: reservation.conversationRef,
      message,
      attachments,
      idempotencyKey: reservation.id,
      timeoutMs: 30_000,
    });
    if (dispatched.outcome === 'rejected') throw dispatched.error;
    if (dispatched.outcome === 'unknown') {
      const nextAttemptAt = Date.now() + canvasSendRetryDelay(reservation.attemptCount);
      store.scheduleReservationRetry(reservation.id, 'ambiguous', dispatched.error.message, nextAttemptAt);
      publishCanvasChanged(reservation.ownerId, reservation.canvasId);
      return store.getReservation(reservation.id)!;
    }
    const interaction = store.acknowledgeSend(
      reservation.ownerId,
      reservation.id,
      null,
      bootstrapWarnings,
      dispatched.turnRef,
    );
    registerCanvasInteraction(reservation, interaction, dispatched.turnRef);
    scheduleCanvasInteractionReconciliation(interaction.id);
    publishCanvasChanged(reservation.ownerId, reservation.canvasId);
    return interaction;
  } catch (error) {
    const store = getCanvasStore();
    const reservation = store.getDispatchableReservation(reservationId);
    if (!reservation) throw error;
    if (!(error instanceof RuntimeOperationError)
      || ['validation', 'unsupported', 'rejected', 'conflict'].includes(error.kind)) {
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
      const ambiguous = error.kind === 'unknown_outcome';
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
