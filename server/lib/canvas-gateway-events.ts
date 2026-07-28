import { createHash } from 'node:crypto';
import {
  getCanvasStore,
  type DispatchableSendReservation,
  type InteractionRecord,
  type OwnedInteractionRecord,
} from './canvas-db.js';
import {
  scheduleCanvasInteractionReconciliation,
  signalCanvasInteractionTerminal,
} from './canvas-reconciler.js';
import { publishCanvasChanged, publishCanvasPreview } from './canvas-sync.js';
import type { GatewayEvent } from './gateway-rpc.js';

function eventRunId(event: GatewayEvent): string {
  const payload = event.payload && typeof event.payload === 'object'
    ? event.payload as Record<string, unknown>
    : {};
  return typeof payload.runId === 'string'
    ? payload.runId
    : typeof payload.run_id === 'string'
      ? payload.run_id
      : '';
}

function eventSessionKey(event: GatewayEvent): string {
  const payload = event.payload && typeof event.payload === 'object'
    ? event.payload as Record<string, unknown>
    : {};
  return typeof payload.sessionKey === 'string'
    ? payload.sessionKey
    : typeof payload.session_key === 'string'
      ? payload.session_key
      : '';
}

function activeView(interaction: OwnedInteractionRecord) {
  return {
    ownerId: interaction.ownerId,
    canvasId: interaction.canvasId,
    branchId: interaction.branchId,
    interactionId: interaction.id,
    sessionKey: interaction.sessionKey,
  };
}

function findActive(event: GatewayEvent) {
  const interaction = getCanvasStore().findInteractionByGatewayCorrelation(
    eventRunId(event),
    eventSessionKey(event),
  );
  return interaction ? activeView(interaction) : null;
}

function gatewayEventState(event: GatewayEvent): string {
  const payload = event.payload && typeof event.payload === 'object'
    ? event.payload as Record<string, unknown>
    : {};
  return typeof payload.state === 'string' ? payload.state : '';
}

function eventAssistantText(event: GatewayEvent): string | null {
  const payload = event.payload && typeof event.payload === 'object'
    ? event.payload as Record<string, unknown>
    : {};
  const message = payload.message;
  if (typeof message === 'string') return message;
  if (!message || typeof message !== 'object') return null;
  const content = (message as Record<string, unknown>).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  return content.map((block) => {
    if (typeof block === 'string') return block;
    return block && typeof block === 'object' && typeof (block as Record<string, unknown>).text === 'string'
      ? (block as Record<string, unknown>).text as string
      : '';
  }).join('');
}

export function projectCanvasGatewayEvent(event: GatewayEvent): {
  runId: string;
  sessionKey: string;
  state: string;
  assistantText: string | null;
  terminal: boolean;
  failure: string | null;
} {
  const state = gatewayEventState(event);
  const payload = event.payload && typeof event.payload === 'object'
    ? event.payload as Record<string, unknown>
    : {};
  const failure = state === 'error' || state === 'aborted'
    ? [payload.errorMessage, payload.error, payload.stopReason]
      .find((value): value is string => typeof value === 'string') || 'OpenClaw run failed'
    : null;
  return {
    runId: eventRunId(event),
    sessionKey: eventSessionKey(event),
    state,
    assistantText: eventAssistantText(event),
    terminal: event.event === 'chat' && ['final', 'error', 'aborted'].includes(state),
    failure,
  };
}

function checkpointOutput(active: NonNullable<ReturnType<typeof findActive>>, output: string): void {
  publishCanvasPreview({
    ownerId: active.ownerId,
    canvasId: active.canvasId,
    interactionId: active.interactionId,
    text: output,
  });
}

function gatewaySignalKey(event: GatewayEvent): string {
  if (event.seq !== undefined) {
    return `${eventRunId(event) || eventSessionKey(event) || 'gateway'}:${event.event}:${event.seq}`;
  }
  return createHash('sha256')
    .update(JSON.stringify({ event: event.event, payload: event.payload ?? null }))
    .digest('hex');
}

function processGatewayEvent(event: GatewayEvent, signalKey?: string): void {
  const active = findActive(event);
  if (!active || event.event !== 'chat') return;
  const projected = projectCanvasGatewayEvent(event);
  const state = projected.state;
  if (state === 'delta') {
    const output = projected.assistantText;
    if (output !== null) checkpointOutput(active, output);
    return;
  }
  if (state === 'final') {
    const finalOutput = projected.assistantText;
    if (finalOutput !== null) checkpointOutput(active, finalOutput);
    signalCanvasInteractionTerminal(active.interactionId, active.ownerId, {
      runId: eventRunId(event) || undefined,
    });
    scheduleCanvasInteractionReconciliation(active.interactionId, 0);
    if (signalKey) getCanvasStore().markGatewaySignalProcessed(signalKey);
    return;
  }
  if (state === 'error' || state === 'aborted') {
    signalCanvasInteractionTerminal(active.interactionId, active.ownerId, {
      runId: eventRunId(event) || undefined,
      failureHint: projected.failure || 'OpenClaw run failed',
    });
    scheduleCanvasInteractionReconciliation(active.interactionId, 0);
    if (signalKey) getCanvasStore().markGatewaySignalProcessed(signalKey);
  }
}

export function handleCanvasGatewayEvent(event: GatewayEvent): void {
  if (!projectCanvasGatewayEvent(event).terminal) {
    processGatewayEvent(event);
    return;
  }
  const eventKey = gatewaySignalKey(event);
  const inserted = getCanvasStore().recordGatewaySignal({
    eventKey,
    runId: eventRunId(event) || null,
    sessionKey: eventSessionKey(event) || null,
    event: event.event,
    payload: event.payload,
    createdAt: Date.now(),
  });
  if (inserted) processGatewayEvent(event, eventKey);
}

export function registerCanvasInteraction(
  reservation: DispatchableSendReservation,
  interaction: InteractionRecord,
  runId: string | null,
): void {
  publishCanvasChanged(reservation.ownerId, reservation.canvasId);
  for (const signal of getCanvasStore().listPendingGatewaySignals(runId || '', reservation.sessionKey)) {
    processGatewayEvent({
      type: 'event',
      event: signal.event,
      payload: signal.payload,
    }, signal.eventKey);
  }
}
