import { createHash } from 'node:crypto';
import type { BackendEvent, BackendHandle } from '../agent-backends/contract.js';
import {
  getCanvasStore,
  type DispatchableSendReservation,
  type InteractionRecord,
  type OwnedInteractionRecord,
} from '../canvas-db.js';
import {
  scheduleCanvasInteractionReconciliation,
  signalCanvasInteractionTerminal,
} from '../canvas-reconciler.js';
import { publishCanvasChanged, publishCanvasPreview } from '../canvas-sync.js';

function activeView(interaction: OwnedInteractionRecord) {
  return {
    ownerId: interaction.ownerId,
    canvasId: interaction.canvasId,
    interactionId: interaction.id,
  };
}

function findActive(event: BackendEvent) {
  const interaction = getCanvasStore().findInteractionByBackendCorrelation(
    event.backendId,
    event.turnRef || null,
    event.conversationRef || null,
  );
  return interaction ? activeView(interaction) : null;
}

function eventKey(event: BackendEvent): string {
  if (event.eventId) return event.eventId;
  return createHash('sha256').update(JSON.stringify(event)).digest('hex');
}

function terminal(event: BackendEvent): boolean {
  return event.type === 'turn.completed'
    || event.type === 'turn.failed'
    || event.type === 'turn.interrupted';
}

function processBackendEvent(event: BackendEvent, storedKey?: string): void {
  const active = findActive(event);
  if (!active) return;
  if (event.type === 'approval.required') {
    getCanvasStore().recordInteractionApproval(
      active.interactionId,
      event.backendId,
      event.approvalRef,
      event.approval,
      event.createdAt,
    );
    publishCanvasChanged(active.ownerId, active.canvasId);
    if (storedKey) getCanvasStore().markBackendEventProcessed(storedKey);
    return;
  }
  if (event.type === 'approval.resolved') {
    getCanvasStore().applyInteractionApprovalResolution(
      event.backendId,
      event.approvalRef,
      event.resolution,
      event.resolvedBy,
    );
    publishCanvasChanged(active.ownerId, active.canvasId);
    if (storedKey) getCanvasStore().markBackendEventProcessed(storedKey);
    return;
  }
  if (event.type === 'output.text.delta' || event.type === 'output.message.completed') {
    publishCanvasPreview({
      ownerId: active.ownerId,
      canvasId: active.canvasId,
      interactionId: active.interactionId,
      text: event.text,
    });
    return;
  }
  if (!terminal(event)) return;
  const text = event.type === 'turn.completed' ? event.text : undefined;
  if (text !== undefined) {
    publishCanvasPreview({
      ownerId: active.ownerId,
      canvasId: active.canvasId,
      interactionId: active.interactionId,
      text,
    });
  }
  const failureHint = event.type === 'turn.failed'
    ? event.error
    : event.type === 'turn.interrupted'
      ? event.error || 'Agent turn interrupted'
      : undefined;
  signalCanvasInteractionTerminal(active.interactionId, active.ownerId, {
    ...(failureHint ? { failureHint } : {}),
  });
  scheduleCanvasInteractionReconciliation(active.interactionId, 0);
  if (storedKey) getCanvasStore().markBackendEventProcessed(storedKey);
}

export function handleCanvasBackendEvent(event: BackendEvent): void {
  const durable = terminal(event)
    || event.type === 'approval.required'
    || event.type === 'approval.resolved'
    || event.type === 'backend.disconnected';
  if (!durable) {
    processBackendEvent(event);
    return;
  }
  const key = eventKey(event);
  const inserted = getCanvasStore().recordBackendEvent({
    eventKey: key,
    backendId: event.backendId,
    conversationRef: event.conversationRef || null,
    turnRef: event.turnRef || null,
    event,
    createdAt: event.createdAt,
  });
  if (!inserted) return;
  if (terminal(event) || event.type === 'approval.required' || event.type === 'approval.resolved') {
    processBackendEvent(event, key);
  }
}

export function registerCanvasInteraction(
  reservation: DispatchableSendReservation,
  interaction: InteractionRecord,
  turnRef: BackendHandle | null,
): void {
  publishCanvasChanged(reservation.ownerId, reservation.canvasId);
  if (!reservation.conversationRef) return;
  for (const stored of getCanvasStore().listPendingBackendEvents(
    reservation.backendId,
    turnRef,
    reservation.conversationRef,
  )) {
    processBackendEvent(stored.event, stored.eventKey);
  }
}
