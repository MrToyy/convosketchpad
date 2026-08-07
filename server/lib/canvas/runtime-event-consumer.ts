import { createHash } from 'node:crypto';
import type { RuntimeEvent, RuntimeHandle } from '../agent-runtimes/contract.js';
import type { CanvasStore } from './persistence/canvas-store.js';
import type {
  DispatchableSendReservation,
  InteractionRecord,
  OwnedInteractionRecord,
} from './model.js';
import {
  scheduleCanvasInteractionReconciliation,
  signalCanvasInteractionTerminal,
} from '../canvas-reconciler.js';
import { publishCanvasChanged, publishCanvasPreview } from '../canvas-sync.js';
import type { RuntimeTextPreviewAssembler } from './runtime-text-preview.js';

function activeView(interaction: OwnedInteractionRecord) {
  return {
    ownerId: interaction.ownerId,
    canvasId: interaction.canvasId,
    interactionId: interaction.id,
  };
}

function findActive(store: CanvasStore, event: RuntimeEvent, includeTerminal = false) {
  const interaction = store.findInteractionByRuntimeCorrelation(
    event.runtimeId,
    event.turnRef || null,
    event.conversationRef || null,
    includeTerminal,
  );
  return interaction ? activeView(interaction) : null;
}

function eventKey(event: RuntimeEvent): string {
  const nativeKey = event.eventId
    || createHash('sha256').update(JSON.stringify(event)).digest('hex');
  return `${event.runtimeId}:${nativeKey}`;
}

function terminal(event: RuntimeEvent): boolean {
  return event.type === 'turn.completed'
    || event.type === 'turn.failed'
    || event.type === 'turn.interrupted';
}

function processRuntimeEvent(
  store: CanvasStore,
  event: RuntimeEvent,
  storedKey?: string,
  previews?: RuntimeTextPreviewAssembler,
): void {
  if (event.type === 'approval.resolved') {
    const resolution = store.applyInteractionApprovalResolution(
      event.runtimeId,
      event.approvalRef,
      event.resolution,
      event.resolvedBy,
    );
    if (!resolution) return;
    publishCanvasChanged(resolution.ownerId, resolution.canvasId);
    if (storedKey) store.markRuntimeEventProcessed(storedKey);
    return;
  }
  const active = findActive(store, event, event.type === 'approval.required');
  if (!active) return;
  if (event.type === 'approval.required') {
    store.recordInteractionApproval(
      active.interactionId,
      event.runtimeId,
      event.approvalRef,
      event.approval,
      event.createdAt,
    );
    publishCanvasChanged(active.ownerId, active.canvasId);
    if (storedKey) store.markRuntimeEventProcessed(storedKey);
    return;
  }
  if (
    event.type === 'output.text.delta'
    || event.type === 'output.text.snapshot'
    || event.type === 'output.message.completed'
  ) {
    publishCanvasPreview({
      ownerId: active.ownerId,
      canvasId: active.canvasId,
      interactionId: active.interactionId,
      text: previews?.apply(active.interactionId, event) || event.text,
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
  previews?.clear(active.interactionId);
  const failureHint = event.type === 'turn.failed'
    ? event.error
    : event.type === 'turn.interrupted'
      ? event.error || 'Agent turn interrupted'
      : undefined;
  signalCanvasInteractionTerminal(active.interactionId, active.ownerId, {
    ...(failureHint ? { failureHint } : {}),
  });
  scheduleCanvasInteractionReconciliation(active.interactionId, 0);
  if (storedKey) store.markRuntimeEventProcessed(storedKey);
}

export function handleCanvasRuntimeEvent(
  store: CanvasStore,
  event: RuntimeEvent,
  previews?: RuntimeTextPreviewAssembler,
): void {
  const durable = terminal(event)
    || event.type === 'approval.required'
    || event.type === 'approval.resolved';
  if (!durable) {
    processRuntimeEvent(store, event, undefined, previews);
    return;
  }
  const key = eventKey(event);
  const inserted = store.recordRuntimeEvent({
    eventKey: key,
    runtimeId: event.runtimeId,
    conversationRef: event.conversationRef || null,
    turnRef: event.turnRef || null,
    event,
    createdAt: event.createdAt,
  });
  if (!inserted) return;
  if (terminal(event) || event.type === 'approval.required' || event.type === 'approval.resolved') {
    processRuntimeEvent(store, event, key, previews);
  }
}

export function registerCanvasInteraction(
  store: CanvasStore,
  reservation: DispatchableSendReservation,
  interaction: InteractionRecord,
  turnRef: RuntimeHandle | null,
): void {
  publishCanvasChanged(reservation.ownerId, reservation.canvasId);
  if (!reservation.conversationRef) return;
  for (const stored of store.listPendingRuntimeEvents(
    reservation.runtimeId,
    turnRef,
    reservation.conversationRef,
  )) {
    processRuntimeEvent(store, stored.event, stored.eventKey);
  }
}
