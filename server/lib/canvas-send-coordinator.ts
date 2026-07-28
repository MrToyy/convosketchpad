import { createHash } from 'node:crypto';
import {
  GatewayDispatchError,
  gatewayDispatchCall,
  getGatewayRuntimeStatus,
  gatewaySupports,
  subscribeGatewayEvents,
  subscribeGatewayStatus,
  type GatewayEvent,
} from './gateway-rpc.js';
import { readCanvasArtifact, readCanvasAttachment } from './canvas-artifact-store.js';
import {
  getCanvasStore,
  type CanvasContextResource,
  type DispatchableSendReservation,
  type InteractionRecord,
  type OwnedInteractionRecord,
  type SendReservation,
} from './canvas-db.js';
import {
  canvasReplayResourceFileName,
} from './canvas-replay-plan.js';
import {
  CANVAS_DELIVERY_MAX_BYTES,
  ensureCanvasMediaDerivative,
} from './canvas-media-derivatives.js';
import {
  rescanCanvasReconciliationCandidates,
  scheduleCanvasInteractionReconciliation,
  signalCanvasInteractionTerminal,
} from './canvas-reconciler.js';
import {
  canvasSendRetryDelay,
  canvasSendRetryWakeAt,
} from './canvas-send-retry.js';
import { publishRuntimeEvent } from './runtime-events.js';
import { publishCanvasChanged, publishCanvasPreview } from './canvas-sync.js';

const activeDispatches = new Set<string>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimerAt: number | null = null;
let retryScanRunning = false;
let retryScanRequested = false;
let started = false;
let unsubscribeEvents: (() => void) | null = null;
let unsubscribeStatus: (() => void) | null = null;

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
  if (!active) return;
  const state = gatewayEventState(event);
  if (event.event !== 'chat') return;
  if (state === 'delta') {
    const output = eventAssistantText(event);
    if (output !== null) checkpointOutput(active, output);
    return;
  }
  if (state === 'final') {
    const finalOutput = eventAssistantText(event);
    if (finalOutput !== null) checkpointOutput(active, finalOutput);
    signalCanvasInteractionTerminal(active.interactionId, active.ownerId, { runId: eventRunId(event) || undefined });
    scheduleCanvasInteractionReconciliation(active.interactionId, 0);
    if (signalKey) getCanvasStore().markGatewaySignalProcessed(signalKey);
    return;
  }
  if (state === 'error' || state === 'aborted') {
    const payload = event.payload as Record<string, unknown>;
    const reason = [payload.errorMessage, payload.error, payload.stopReason]
      .find((value): value is string => typeof value === 'string') || 'OpenClaw run failed';
    signalCanvasInteractionTerminal(active.interactionId, active.ownerId, {
      runId: eventRunId(event) || undefined,
      failureHint: reason,
    });
    scheduleCanvasInteractionReconciliation(active.interactionId, 0);
    if (signalKey) getCanvasStore().markGatewaySignalProcessed(signalKey);
    return;
  }
}

function handleGatewayEvent(event: GatewayEvent): void {
  const state = gatewayEventState(event);
  const terminal = event.event === 'chat' && ['final', 'error', 'aborted'].includes(state);
  if (!terminal) {
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

async function loadContextResource(
  reservation: DispatchableSendReservation,
  resource: CanvasContextResource,
): Promise<{ fileName: string; mimeType: string; content: string }> {
  const store = getCanvasStore();
  let bytes: Uint8Array | null = null;
  let recordContentHash: ((contentHash: string) => void) | undefined;
  if (resource.uri.startsWith('/api/canvas/attachments/')) {
    const match = resource.uri.match(/^\/api\/canvas\/attachments\/([^/]+)\/([^/]+)$/);
    if (match && decodeURIComponent(match[1]) === reservation.canvasId) {
      const attachmentId = decodeURIComponent(match[2]);
      recordContentHash = (contentHash) => {
        store.setCanvasAttachmentContentHash(
          reservation.ownerId,
          reservation.canvasId,
          attachmentId,
          contentHash,
        );
      };
    }
  } else if (resource.uri.startsWith('/api/canvas/artifacts/')) {
    const interaction = store.getOwnedInteraction(reservation.ownerId, resource.sourceInteractionId);
    const match = resource.uri.match(/^\/api\/canvas\/artifacts\/([^/]+)\/([^/]+)\/([^/]+)$/);
    if (interaction && match) {
      const artifactId = decodeURIComponent(match[3]);
      recordContentHash = (contentHash) => {
        store.setInteractionArtifactContentHash(
          reservation.ownerId,
          interaction.id,
          artifactId,
          contentHash,
        );
      };
    }
  }
  const loadBytes = async () => {
    if (bytes) return bytes;
    if (resource.uri.startsWith('/api/canvas/attachments/')) {
      const match = resource.uri.match(/^\/api\/canvas\/attachments\/([^/]+)\/([^/]+)$/);
      if (match && decodeURIComponent(match[1]) === reservation.canvasId) {
        bytes = await readCanvasAttachment(
          reservation.ownerId,
          reservation.canvasId,
          decodeURIComponent(match[2]),
        );
      }
    } else if (resource.uri.startsWith('/api/canvas/artifacts/')) {
      const interaction = store.getOwnedInteraction(reservation.ownerId, resource.sourceInteractionId);
      const match = resource.uri.match(/^\/api\/canvas\/artifacts\/([^/]+)\/([^/]+)\/([^/]+)$/);
      if (interaction && match) {
        bytes = (await readCanvasArtifact(interaction, decodeURIComponent(match[3])))?.bytes || null;
      }
    } else if (resource.uri.startsWith('data:')) {
      const match = resource.uri.match(/^data:[^;,]+;base64,(.+)$/s);
      if (match) bytes = Buffer.from(match[1], 'base64');
    }
    return bytes;
  };

  if (resource.mimeType.startsWith('image/')
    && (resource.sizeBytes || 0) > CANVAS_DELIVERY_MAX_BYTES) {
    const prepared = await ensureCanvasMediaDerivative(store, {
      ownerId: reservation.ownerId,
      canvasId: reservation.canvasId,
      name: resource.name,
      mimeType: resource.mimeType,
      contentHash: resource.contentHash,
      loadBytes,
      recordContentHash,
    }, 'delivery');
    return {
      fileName: canvasReplayResourceFileName(resource),
      mimeType: prepared.derivative.mimeType,
      content: Buffer.from(prepared.bytes).toString('base64'),
    };
  }
  bytes = await loadBytes();
  if (!bytes) throw new Error('resource_unavailable');
  if (resource.mimeType.startsWith('image/') && bytes.byteLength > CANVAS_DELIVERY_MAX_BYTES) {
    const prepared = await ensureCanvasMediaDerivative(store, {
      ownerId: reservation.ownerId,
      canvasId: reservation.canvasId,
      name: resource.name,
      mimeType: resource.mimeType,
      contentHash: resource.contentHash,
      loadBytes: async () => bytes,
      recordContentHash,
    }, 'delivery');
    return {
      fileName: canvasReplayResourceFileName(resource),
      mimeType: prepared.derivative.mimeType,
      content: Buffer.from(prepared.bytes).toString('base64'),
    };
  }
  return {
    fileName: canvasReplayResourceFileName(resource),
    mimeType: resource.mimeType || 'application/octet-stream',
    content: Buffer.from(bytes).toString('base64'),
  };
}

async function gatewayAttachments(reservation: DispatchableSendReservation) {
  const store = getCanvasStore();
  const attachments = [];
  const bootstrapWarnings: string[] = [];
  for (const resource of reservation.bootstrapResources) {
    try {
      attachments.push(await loadContextResource(reservation, resource));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!['resource_unavailable', 'media_source_unavailable'].includes(message)) throw error;
      bootstrapWarnings.push(`${resource.name}: resource unavailable`);
    }
  }
  for (const attachment of reservation.attachments) {
    if (!attachment.id) throw new Error('attachment_not_found');
    const originalBytes = await readCanvasAttachment(
      reservation.ownerId,
      reservation.canvasId,
      attachment.id,
    );
    if (!originalBytes) throw new Error('attachment_unavailable');
    const prepared = attachment.mimeType.startsWith('image/')
      && originalBytes.byteLength > CANVAS_DELIVERY_MAX_BYTES
      ? await ensureCanvasMediaDerivative(store, {
        ownerId: reservation.ownerId,
        canvasId: reservation.canvasId,
        name: attachment.name,
        mimeType: attachment.mimeType,
        contentHash: attachment.contentHash,
        loadBytes: async () => originalBytes,
        recordContentHash: (contentHash) => {
          store.setCanvasAttachmentContentHash(
            reservation.ownerId,
            reservation.canvasId,
            attachment.id!,
            contentHash,
          );
        },
      }, 'delivery')
      : null;
    const bytes = prepared?.bytes || originalBytes;
    if (!bytes) throw new Error('attachment_unavailable');
    attachments.push({
      fileName: attachment.name,
      mimeType: prepared?.derivative.mimeType || attachment.mimeType,
      content: Buffer.from(bytes).toString('base64'),
    });
  }
  return { attachments, bootstrapWarnings };
}

function assertReplayPayloadFits(
  reservation: DispatchableSendReservation,
  params: Record<string, unknown>,
): void {
  if (!['canonical-replay', 'session-recovery'].includes(reservation.materialization)) return;
  const maxPayload = getGatewayRuntimeStatus().maxPayload;
  if (!maxPayload) return;
  const estimatedBytes = Buffer.byteLength(JSON.stringify({
    type: 'req',
    id: reservation.id,
    method: 'chat.send',
    params,
  }));
  const safeLimit = Math.max(0, maxPayload - 8 * 1024);
  if (estimatedBytes > safeLimit) throw new Error('replay_payload_too_large');
}

function registerInteraction(
  reservation: DispatchableSendReservation,
  interaction: InteractionRecord,
  runId: string | null,
): void {
  const active = {
    ownerId: reservation.ownerId,
    canvasId: reservation.canvasId,
    branchId: reservation.branchId,
    interactionId: interaction.id,
    sessionKey: reservation.sessionKey,
  };
  publishCanvasChanged(active.ownerId, active.canvasId);
  for (const signal of getCanvasStore().listPendingGatewaySignals(runId || '', reservation.sessionKey)) {
    processGatewayEvent({
      type: 'event',
      event: signal.event,
      payload: signal.payload,
    }, signal.eventKey);
  }
}

export async function dispatchCanvasSend(reservationId: string): Promise<SendReservation | InteractionRecord> {
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
    if (gatewaySupports('chat.send') === false) {
      const status = getGatewayRuntimeStatus();
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
    const { attachments, bootstrapWarnings } = await gatewayAttachments(reservation);
    const preparedReservation = store.getDispatchableReservation(reservation.id);
    if (!preparedReservation) throw new Error('not_found');
    if (preparedReservation.status !== 'prepared') return preparedReservation;
    store.markReservationDispatching(reservation.id);
    reservation = store.getDispatchableReservation(reservation.id)!;
    let message = reservation.outgoingMessage;
    if (bootstrapWarnings.length) {
      message += `\n\nCanvas replay note: Some restored files could not be attached: ${bootstrapWarnings.join('; ')}`;
    }
    const params = {
      sessionKey: reservation.sessionKey,
      message,
      ...(attachments.length ? { attachments } : {}),
      deliver: false,
      idempotencyKey: reservation.id,
    };
    assertReplayPayloadFits(reservation, params);
    const raw = await gatewayDispatchCall('chat.send', params, 30_000) as { runId?: unknown };
    const runId = typeof raw?.runId === 'string' ? raw.runId : null;
    const interaction = store.acknowledgeSend(reservation.ownerId, reservation.id, runId, bootstrapWarnings);
    registerInteraction(reservation, interaction, runId);
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
      const ambiguous = error instanceof GatewayDispatchError && error.kind === 'outcome_unknown';
      const nextAttemptAt = Date.now() + canvasSendRetryDelay(reservation.attemptCount);
      store.scheduleReservationRetry(
        reservation.id,
        ambiguous ? 'ambiguous' : 'reserved',
        error instanceof Error ? error.message : 'Gateway unavailable',
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
        error: error instanceof Error ? error.name : 'Gateway unavailable',
      }));
      publishCanvasChanged(reservation.ownerId, reservation.canvasId);
    }
    return store.getReservation(reservationId)!;
  } finally {
    activeDispatches.delete(reservationId);
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
      .filter((reservation) => !activeDispatches.has(reservation.id));
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
    activeDispatches.size > 0,
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
  unsubscribeEvents = subscribeGatewayEvents(handleGatewayEvent);
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
  activeDispatches.clear();
  unsubscribeEvents?.();
  unsubscribeStatus?.();
  unsubscribeEvents = null;
  unsubscribeStatus = null;
}
