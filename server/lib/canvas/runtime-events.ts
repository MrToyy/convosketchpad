import { createHash } from 'node:crypto';
import type { RuntimeEvent, RuntimeHandle } from '../agent-runtimes/contract.js';
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

function findActive(event: RuntimeEvent) {
  const interaction = getCanvasStore().findInteractionByRuntimeCorrelation(
    event.runtimeId,
    event.turnRef || null,
    event.conversationRef || null,
  );
  return interaction ? activeView(interaction) : null;
}

function eventKey(event: RuntimeEvent): string {
  if (event.eventId) return event.eventId;
  return createHash('sha256').update(JSON.stringify(event)).digest('hex');
}

function terminal(event: RuntimeEvent): boolean {
  return event.type === 'turn.completed'
    || event.type === 'turn.failed'
    || event.type === 'turn.interrupted';
}

function processRuntimeEvent(event: RuntimeEvent, storedKey?: string): void {
  const active = findActive(event);
  if (!active) return;
  if (event.type === 'approval.required') {
    getCanvasStore().recordInteractionApproval(
      active.interactionId,
      event.runtimeId,
      event.approvalRef,
      event.approval,
      event.createdAt,
    );
    publishCanvasChanged(active.ownerId, active.canvasId);
    if (storedKey) getCanvasStore().markRuntimeEventProcessed(storedKey);
    return;
  }
  if (event.type === 'approval.resolved') {
    getCanvasStore().applyInteractionApprovalResolution(
      event.runtimeId,
      event.approvalRef,
      event.resolution,
      event.resolvedBy,
    );
    publishCanvasChanged(active.ownerId, active.canvasId);
    if (storedKey) getCanvasStore().markRuntimeEventProcessed(storedKey);
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
  if (storedKey) getCanvasStore().markRuntimeEventProcessed(storedKey);
}

export function handleCanvasRuntimeEvent(event: RuntimeEvent): void {
  const durable = terminal(event)
    || event.type === 'approval.required'
    || event.type === 'approval.resolved'
    || event.type === 'runtime.disconnected';
  if (!durable) {
    processRuntimeEvent(event);
    return;
  }
  const key = eventKey(event);
  const inserted = getCanvasStore().recordRuntimeEvent({
    eventKey: key,
    runtimeId: event.runtimeId,
    conversationRef: event.conversationRef || null,
    turnRef: event.turnRef || null,
    event,
    createdAt: event.createdAt,
  });
  if (!inserted) return;
  if (terminal(event) || event.type === 'approval.required' || event.type === 'approval.resolved') {
    processRuntimeEvent(event, key);
  }
}

export function registerCanvasInteraction(
  reservation: DispatchableSendReservation,
  interaction: InteractionRecord,
  turnRef: RuntimeHandle | null,
): void {
  publishCanvasChanged(reservation.ownerId, reservation.canvasId);
  if (!reservation.conversationRef) return;
  for (const stored of getCanvasStore().listPendingRuntimeEvents(
    reservation.runtimeId,
    turnRef,
    reservation.conversationRef,
  )) {
    processRuntimeEvent(stored.event, stored.eventKey);
  }
}
