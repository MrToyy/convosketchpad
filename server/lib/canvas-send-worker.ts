import type { CanvasStore } from './canvas/persistence/canvas-store.js';
import type { InteractionRecord, SendReservation } from './canvas/model.js';
import {
  buildCanvasDelivery,
} from './canvas-send-delivery.js';
import { handleCanvasRuntimeEvent, registerCanvasInteraction } from './canvas/runtime-event-consumer.js';
import type { RuntimeEvent } from './agent-runtimes/contract.js';
import type { RuntimeTextPreviewAssembler } from './canvas/runtime-text-preview.js';
import { RuntimeOperationError } from './agent-runtimes/contract.js';
import type { AgentRuntime } from './agent-runtimes/contract.js';
import { CANVAS_DELIVERY_MAX_BYTES } from './canvas-media-derivatives.js';
import { scheduleCanvasInteractionReconciliation } from './canvas-reconciler.js';
import { canvasSendRetryDelay } from './canvas/domain/send-retry.js';
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

export function consumeCanvasRuntimeEvent(
  store: CanvasStore,
  event: RuntimeEvent,
  previews?: RuntimeTextPreviewAssembler,
): void {
  handleCanvasRuntimeEvent(store, event, previews);
}

export async function runCanvasSendWorker(
  reservationId: string,
  runtimeResolver: (runtimeId: string) => AgentRuntime,
  store: CanvasStore,
): Promise<SendReservation | InteractionRecord> {
  if (activeDispatches.has(reservationId)) {
    return store.getReservation(reservationId) || Promise.reject(new Error('not_found'));
  }
  activeDispatches.add(reservationId);
  try {
    let reservation = store.getDispatchableReservation(reservationId);
    if (!reservation) throw new Error('not_found');
    if (reservation.status === 'acknowledged' && reservation.interactionId) {
      return store.getOwnedInteraction(reservation.ownerId, reservation.interactionId) || reservation;
    }
    if (reservation.status !== 'prepared') return reservation;
    const runtime = runtimeResolver(reservation.runtimeId);
    const profile = {
      runtimeId: runtime.id,
      profileId: reservation.agentProfileId,
    };
    const capabilities = await runtime.getCapabilities(profile);
    if (!capabilities.input.text) {
      const status = runtime.getStatus();
      if (status.state === 'connected') {
        store.failReservationById(reservation.id, 'runtime_text_input_unsupported');
        publishCanvasChanged(reservation.ownerId, reservation.canvasId);
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
    const { message, attachments, bootstrapWarnings } = await buildCanvasDelivery(reservation, store);
    let preparedReservation = store.getDispatchableReservation(reservation.id);
    if (!preparedReservation) throw new Error('not_found');
    if (preparedReservation.status !== 'prepared') return preparedReservation;
    if (!preparedReservation.conversationRef) {
      throw new RuntimeOperationError('validation', 'Reservation has no conversation reference');
    }
    if (preparedReservation.dispatchState === 'ambiguous' && !capabilities.reliability.idempotentDispatch) {
      if (!capabilities.reliability.inspectAfterUnknownOutcome) {
        const nextAttemptAt = Date.now() + canvasSendRetryDelay(preparedReservation.attemptCount);
        store.scheduleReservationRetry(
          preparedReservation.id,
          'ambiguous',
          preparedReservation.error || 'Runtime dispatch outcome remains unknown',
          nextAttemptAt,
          preparedReservation.dispatchRecoveryRef,
        );
        publishCanvasChanged(preparedReservation.ownerId, preparedReservation.canvasId);
        return store.getReservation(preparedReservation.id)!;
      }
      let reconciled;
      try {
        reconciled = await runtime.reconcileDispatch({
          profile,
          conversationRef: preparedReservation.conversationRef,
          recoveryRef: preparedReservation.dispatchRecoveryRef || null,
          idempotencyKey: preparedReservation.id,
          message,
          createdAt: preparedReservation.createdAt,
        });
      } catch (error) {
        const nextAttemptAt = Date.now() + canvasSendRetryDelay(preparedReservation.attemptCount);
        store.scheduleReservationRetry(
          preparedReservation.id,
          'ambiguous',
          error instanceof Error ? error.message : 'Runtime dispatch reconciliation failed',
          nextAttemptAt,
          preparedReservation.dispatchRecoveryRef,
        );
        publishCanvasChanged(preparedReservation.ownerId, preparedReservation.canvasId);
        return store.getReservation(preparedReservation.id)!;
      }
      if (reconciled.outcome === 'accepted') {
        if (reconciled.conversationRef) {
          store.adoptReservationConversation(
            preparedReservation.id,
            reconciled.conversationRef,
            reconciled.conversationInstanceId,
          );
          preparedReservation = store.getDispatchableReservation(preparedReservation.id)!;
        }
        const interaction = store.acknowledgeSend(
          preparedReservation.ownerId,
          preparedReservation.id,
          null,
          bootstrapWarnings,
          reconciled.turnRef,
        );
        registerCanvasInteraction(store, preparedReservation, interaction, reconciled.turnRef);
        scheduleCanvasInteractionReconciliation(interaction.id);
        publishCanvasChanged(preparedReservation.ownerId, preparedReservation.canvasId);
        return interaction;
      }
      if (reconciled.outcome === 'unknown') {
        const nextAttemptAt = Date.now() + canvasSendRetryDelay(preparedReservation.attemptCount);
        store.scheduleReservationRetry(
          preparedReservation.id,
          'ambiguous',
          reconciled.error.message,
          nextAttemptAt,
          reconciled.recoveryRef || preparedReservation.dispatchRecoveryRef,
        );
        publishCanvasChanged(preparedReservation.ownerId, preparedReservation.canvasId);
        return store.getReservation(preparedReservation.id)!;
      }
      store.clearReservationDispatchRecovery(preparedReservation.id);
    }
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
      store.scheduleReservationRetry(
        reservation.id,
        'ambiguous',
        dispatched.error.message,
        nextAttemptAt,
        dispatched.recoveryRef || null,
      );
      publishCanvasChanged(reservation.ownerId, reservation.canvasId);
      return store.getReservation(reservation.id)!;
    }
    if (dispatched.conversationRef) {
      store.adoptReservationConversation(
        reservation.id,
        dispatched.conversationRef,
        dispatched.conversationInstanceId,
      );
      reservation = store.getDispatchableReservation(reservation.id)!;
    }
    const interaction = store.acknowledgeSend(
      reservation.ownerId,
      reservation.id,
      null,
      bootstrapWarnings,
      dispatched.turnRef,
    );
    registerCanvasInteraction(store, reservation, interaction, dispatched.turnRef);
    scheduleCanvasInteractionReconciliation(interaction.id);
    publishCanvasChanged(reservation.ownerId, reservation.canvasId);
    return interaction;
  } catch (error) {
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
