import { createHash } from 'node:crypto';
import { config } from './config.js';
import {
  getCanvasStore,
  type CanvasArtifact,
  type InteractionRecord,
  type OwnedInteractionRecord,
} from './canvas-db.js';
import { gatewayRpcCall } from './gateway-rpc.js';

export const CANVAS_RECONCILIATION_VERSION = 2;
export const CANVAS_SETTLE_MIN_MS = 4_000;
export const CANVAS_SETTLE_MAX_MS = 15_000;

const FOREGROUND_OFFSETS_MS = [500, 1_500, 3_000, 4_000, 6_000, 9_000, 12_000, 15_000];
const BACKGROUND_OFFSETS_MS = [30_000, 60_000, 120_000];
const MAX_MONITOR_AGE_MS = 24 * 60 * 60 * 1_000;
const SLOW_MONITOR_AFTER_MS = 60 * 60 * 1_000;
const SESSION_LIST_LIMIT = 1_000;

type GatewayMessage = Record<string, unknown>;

interface GatewaySessionSummary {
  key?: string;
  sessionKey?: string;
  status?: string;
  error?: string;
  agentState?: string;
  busy?: boolean;
  processing?: boolean;
  updatedAt?: number;
}

export interface CanvasTranscriptSnapshot {
  agentOutput: string;
  artifacts: CanvasArtifact[];
  fingerprint: string;
}

interface SettlementState {
  terminalAt: number;
  lateRecovery: boolean;
  foregroundIndex: number;
  backgroundIndex: number;
  previousFingerprint: string | null;
  stableReads: number;
  best: CanvasTranscriptSnapshot | null;
  failure?: string;
}

interface MonitorState {
  timer: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  settlement?: SettlementState;
}

const monitors = new Map<string, MonitorState>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function messageTimestamp(message: GatewayMessage): number | undefined {
  const value = message.timestamp ?? message.createdAt ?? message.ts;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((item) => {
    const block = asRecord(item);
    if (!block) return '';
    if (typeof block.text === 'string') return block.text;
    if (typeof block.content === 'string') return block.content;
    if (Array.isArray(block.content)) return textFromContent(block.content);
    return '';
  }).filter(Boolean).join('\n');
}

function getMessageText(message: GatewayMessage): string {
  return textFromContent(message.content) || asString(message.text);
}

function getMessageRole(message: GatewayMessage): string {
  return asString(message.role).toLowerCase();
}

function getMessageRunId(message: GatewayMessage): string {
  const direct = asString(message.runId);
  if (direct) return direct;
  const idempotencyKey = asString(message.idempotencyKey);
  return idempotencyKey.includes(':') ? idempotencyKey.split(':')[0] : '';
}

function basename(value: string, fallback: string): string {
  const clean = value.split(/[?#]/)[0].replace(/\/+$/, '');
  try {
    return decodeURIComponent(clean.split('/').pop() || fallback);
  } catch {
    return clean.split('/').pop() || fallback;
  }
}

function inferMimeType(uri: string): string | undefined {
  const clean = uri.split(/[?#]/)[0].toLowerCase();
  if (/\.(png|apng)$/.test(clean)) return 'image/png';
  if (/\.jpe?g$/.test(clean)) return 'image/jpeg';
  if (/\.gif$/.test(clean)) return 'image/gif';
  if (/\.webp$/.test(clean)) return 'image/webp';
  if (/\.svg$/.test(clean)) return 'image/svg+xml';
  if (/\.pdf$/.test(clean)) return 'application/pdf';
  if (/\.(md|txt|log|csv)$/.test(clean)) return 'text/plain';
  if (/\.json$/.test(clean)) return 'application/json';
  return undefined;
}

function filePathUri(filePath: string): string {
  if (/^(?:https?:|data:|file:|\/api\/)/i.test(filePath)) return filePath;
  if (filePath.startsWith('/')) return `/api/files?path=${encodeURIComponent(filePath)}`;
  return filePath;
}

function artifactCollector() {
  const artifacts = new Map<string, CanvasArtifact>();
  const add = (rawUri: unknown, rawName?: unknown, rawMimeType?: unknown, rawSize?: unknown) => {
    const value = asString(rawUri).trim();
    if (!value) return;
    const uri = filePathUri(value);
    if (artifacts.has(uri)) return;
    const mimeType = asString(rawMimeType) || inferMimeType(uri);
    const sizeBytes = asNumber(rawSize);
    artifacts.set(uri, {
      uri,
      name: asString(rawName) || basename(uri, 'artifact'),
      ...(mimeType ? { mimeType } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    });
  };
  return { artifacts, add };
}

function collectBlockArtifacts(block: Record<string, unknown>, add: ReturnType<typeof artifactCollector>['add']): void {
  const type = asString(block.type).toLowerCase();
  const name = block.alt ?? block.filename ?? block.fileName ?? block.name;
  const mimeType = block.mimeType ?? block.media_type ?? block.mediaType;
  const size = block.sizeBytes ?? block.bytes ?? block.size;
  const directUri = block.openUrl ?? block.url ?? block.uri ?? block.href;

  if (directUri && ['image', 'file', 'attachment', 'document', 'audio', 'video'].includes(type)) {
    add(directUri, name, mimeType, size);
  }
  if (block.path && ['file', 'attachment', 'document', 'toolresult', 'tool_result'].includes(type)) {
    add(block.path, name, mimeType, size);
  }
  if (type === 'image' && typeof block.data === 'string') {
    add(`data:${asString(mimeType) || 'image/png'};base64,${block.data}`, name || '图片', mimeType || 'image/png', size);
  }
  const source = asRecord(block.source);
  if (type === 'image' && source && typeof source.data === 'string') {
    const sourceMime = asString(source.media_type) || asString(mimeType) || 'image/png';
    add(`data:${sourceMime};base64,${source.data}`, name || '图片', sourceMime, size);
  }

  const nested = block.content;
  if (Array.isArray(nested)) {
    for (const item of nested) {
      const nestedBlock = asRecord(item);
      if (nestedBlock) collectBlockArtifacts(nestedBlock, add);
    }
  }
}

function collectTextLinks(text: string, add: ReturnType<typeof artifactCollector>['add']): void {
  for (const match of text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) add(match[2], match[1] || '图片', 'image/*');
  for (const match of text.matchAll(/\[([^\]]+)\]\((file:[^)]+|https?:\/\/[^)]+|\/api\/[^)]+)\)/g)) add(match[2], match[1]);
  for (const match of text.matchAll(/(?:^|[\s"'`(])((?:\/[^\s"'`)]+|file:\/\/[^\s"'`)]+)\.(?:png|jpe?g|gif|webp|svg|pdf|txt|md|json|csv|zip))(?:$|[\s"'`),])/gim)) {
    add(match[1], basename(match[1], 'artifact'));
  }
}

function pickInteractionMessages(messages: GatewayMessage[], interaction: InteractionRecord): GatewayMessage[] {
  if (messages.length === 0) return [];
  let userIndex = -1;
  const input = interaction.userInput.trim();

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (getMessageRole(message) !== 'user') continue;
    const text = getMessageText(message);
    if (!input || text.includes(input)) {
      userIndex = index;
      break;
    }
  }

  if (userIndex < 0) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (getMessageRole(messages[index]) === 'user') {
        const timestamp = messageTimestamp(messages[index]);
        if (timestamp === undefined || timestamp <= interaction.createdAt + 15_000) {
          userIndex = index;
          break;
        }
      }
    }
  }

  if (userIndex < 0 && interaction.runId) {
    const runIndexes = messages
      .map((message, index) => getMessageRunId(message) === interaction.runId ? index : -1)
      .filter((index) => index >= 0);
    if (runIndexes.length > 0) return runIndexes.map((index) => messages[index]);
  }

  if (userIndex < 0) return messages.slice(-20);
  let endIndex = messages.length;
  for (let index = userIndex + 1; index < messages.length; index += 1) {
    if (getMessageRole(messages[index]) === 'user') {
      endIndex = index;
      break;
    }
  }
  return messages.slice(userIndex, endIndex);
}

export function extractCanvasTranscript(messages: GatewayMessage[], interaction: InteractionRecord): CanvasTranscriptSnapshot {
  const relevant = pickInteractionMessages(messages, interaction);
  const { artifacts, add } = artifactCollector();

  for (const message of relevant) {
    const role = getMessageRole(message);
    if (role !== 'assistant' && role !== 'tool' && role !== 'toolresult') continue;
    const mediaUrls = toArray(message.MediaUrls);
    const mediaTypes = toArray(message.MediaTypes);
    mediaUrls.forEach((uri, index) => add(uri, `媒体-${index + 1}`, mediaTypes[index]));
    add(message.MediaUrl, '媒体文件', message.MediaType);
    for (const path of toArray(message.MediaPaths)) add(path, basename(asString(path), '媒体文件'));
    add(message.MediaPath, basename(asString(message.MediaPath), '媒体文件'), message.MediaType);

    if (Array.isArray(message.content)) {
      for (const item of message.content) {
        const block = asRecord(item);
        if (block) collectBlockArtifacts(block, add);
      }
    }
    collectTextLinks(getMessageText(message), add);
  }

  const assistants = relevant.filter((message) => getMessageRole(message) === 'assistant');
  const agentOutput = [...assistants].reverse().map(getMessageText).find(Boolean) || '';
  const artifactList = [...artifacts.values()];
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ agentOutput, artifacts: artifactList }))
    .digest('hex');
  return { agentOutput, artifacts: artifactList, fingerprint };
}

function getReconciliation(interaction: InteractionRecord): Record<string, unknown> {
  return asRecord(interaction.sessionMetadata.reconciliation) || {};
}

function sessionKeyOf(session: GatewaySessionSummary): string {
  return session.sessionKey || session.key || '';
}

function sessionIsTerminal(session: GatewaySessionSummary): boolean {
  const status = session.status?.toLowerCase();
  if (status === 'done' || status === 'completed' || status === 'error' || status === 'failed' || status === 'aborted') return true;
  return session.agentState === 'idle' && !session.busy && !session.processing;
}

function sessionFailure(session: GatewaySessionSummary): string | undefined {
  const status = session.status?.toLowerCase();
  if (status === 'error' || status === 'failed' || status === 'aborted') return session.error || `OpenClaw Session ${status}`;
  return undefined;
}

function trackTimer(interactionId: string, delayMs: number, fn: () => void): void {
  const state = monitors.get(interactionId) || { timer: null, startedAt: Date.now() };
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    fn();
  }, Math.max(0, delayMs));
  state.timer.unref?.();
  monitors.set(interactionId, state);
}

function stopMonitor(interactionId: string): void {
  const state = monitors.get(interactionId);
  if (state?.timer) clearTimeout(state.timer);
  monitors.delete(interactionId);
}

async function readTranscript(interaction: OwnedInteractionRecord): Promise<CanvasTranscriptSnapshot> {
  const response = await gatewayRpcCall('sessions.get', {
    key: interaction.sessionKey,
    limit: 500,
    includeTools: true,
  }, 15_000) as { messages?: GatewayMessage[] };
  return extractCanvasTranscript(Array.isArray(response.messages) ? response.messages : [], interaction);
}

function finish(interaction: OwnedInteractionRecord, snapshot: CanvasTranscriptSnapshot | null, input: {
  status?: 'completed' | 'failed';
  artifactSync: 'synced' | 'pending';
  phase?: 'synced' | 'pending';
  terminalAt: number;
  error?: string;
}): void {
  const now = Date.now();
  getCanvasStore().applyReconciledInteraction(interaction.id, {
    status: input.status || (interaction.status === 'failed' ? 'failed' : 'completed'),
    agentOutput: snapshot?.agentOutput || interaction.agentOutput || input.error || '',
    artifacts: snapshot ? snapshot.artifacts : interaction.artifacts,
    reconciliation: {
      version: CANVAS_RECONCILIATION_VERSION,
      phase: input.phase || input.artifactSync,
      artifactSync: input.artifactSync,
      terminalAt: input.terminalAt,
      settledAt: now,
      lastCheckedAt: now,
      ...(snapshot ? { fingerprint: snapshot.fingerprint } : {}),
      ...(input.error ? { lastError: input.error } : { lastError: null }),
    },
  });
}

function scheduleNextSettlementRead(interaction: OwnedInteractionRecord, state: SettlementState): void {
  const now = Date.now();
  const elapsed = now - state.terminalAt;
  if (state.lateRecovery) {
    trackTimer(interaction.id, state.foregroundIndex === 0 ? 0 : 1_000, () => void settlementRead(interaction.id));
    return;
  }
  const offset = FOREGROUND_OFFSETS_MS.find((candidate) => candidate >= elapsed && candidate >= FOREGROUND_OFFSETS_MS[state.foregroundIndex]);
  trackTimer(interaction.id, Math.max(0, (offset ?? CANVAS_SETTLE_MAX_MS) - elapsed), () => void settlementRead(interaction.id));
}

async function settlementRead(interactionId: string): Promise<void> {
  const state = monitors.get(interactionId);
  const settlement = state?.settlement;
  const interaction = getCanvasStore().getInteractionForReconciliation(interactionId);
  if (!state || !settlement || !interaction) {
    stopMonitor(interactionId);
    return;
  }

  let snapshot: CanvasTranscriptSnapshot | null = null;
  let readError: string | undefined;
  try {
    snapshot = await readTranscript(interaction);
    settlement.best = snapshot;
    if (snapshot.fingerprint === settlement.previousFingerprint) settlement.stableReads += 1;
    else settlement.stableReads = 1;
    settlement.previousFingerprint = snapshot.fingerprint;
  } catch (error) {
    readError = error instanceof Error ? error.message : 'Failed to read OpenClaw Transcript';
  }

  const now = Date.now();
  const elapsed = now - settlement.terminalAt;
  getCanvasStore().updateReconciliationMetadata(interactionId, {
    version: CANVAS_RECONCILIATION_VERSION,
    phase: 'settling',
    artifactSync: 'pending',
    terminalAt: settlement.terminalAt,
    lastCheckedAt: now,
    ...(readError ? { lastError: readError } : { lastError: null }),
  });

  if (settlement.failure) {
    finish(interaction, settlement.best, {
      status: 'failed', artifactSync: 'synced', terminalAt: settlement.terminalAt, error: settlement.failure,
    });
    stopMonitor(interactionId);
    return;
  }

  if (settlement.lateRecovery) {
    settlement.foregroundIndex += 1;
    if (settlement.foregroundIndex >= 2) {
      finish(interaction, settlement.best, { artifactSync: 'synced', terminalAt: settlement.terminalAt, error: readError });
      stopMonitor(interactionId);
    } else {
      scheduleNextSettlementRead(interaction, settlement);
    }
    return;
  }

  settlement.foregroundIndex += 1;
  if (elapsed >= CANVAS_SETTLE_MIN_MS && settlement.stableReads >= 2) {
    finish(interaction, settlement.best, { artifactSync: 'synced', terminalAt: settlement.terminalAt });
    stopMonitor(interactionId);
    return;
  }

  if (elapsed >= CANVAS_SETTLE_MAX_MS) {
    finish(interaction, settlement.best, { artifactSync: 'pending', terminalAt: settlement.terminalAt, error: readError });
    settlement.backgroundIndex = 0;
    scheduleBackgroundRead(interaction.id, settlement);
    return;
  }

  scheduleNextSettlementRead(interaction, settlement);
}

function scheduleBackgroundRead(interactionId: string, settlement: SettlementState): void {
  const offset = BACKGROUND_OFFSETS_MS[settlement.backgroundIndex];
  if (offset === undefined) {
    const interaction = getCanvasStore().getInteractionForReconciliation(interactionId);
    if (interaction) finish(interaction, settlement.best, { artifactSync: 'synced', terminalAt: settlement.terminalAt });
    stopMonitor(interactionId);
    return;
  }
  trackTimer(interactionId, Math.max(0, settlement.terminalAt + offset - Date.now()), () => void backgroundRead(interactionId));
}

async function backgroundRead(interactionId: string): Promise<void> {
  const state = monitors.get(interactionId);
  const settlement = state?.settlement;
  const interaction = getCanvasStore().getInteractionForReconciliation(interactionId);
  if (!state || !settlement || !interaction) {
    stopMonitor(interactionId);
    return;
  }

  try {
    const snapshot = await readTranscript(interaction);
    const unchanged = snapshot.fingerprint === settlement.previousFingerprint;
    settlement.best = snapshot;
    settlement.previousFingerprint = snapshot.fingerprint;
    finish(interaction, snapshot, {
      artifactSync: unchanged || settlement.backgroundIndex === BACKGROUND_OFFSETS_MS.length - 1 ? 'synced' : 'pending',
      terminalAt: settlement.terminalAt,
    });
    if (unchanged || settlement.backgroundIndex === BACKGROUND_OFFSETS_MS.length - 1) {
      stopMonitor(interactionId);
      return;
    }
  } catch (error) {
    getCanvasStore().updateReconciliationMetadata(interactionId, {
      version: CANVAS_RECONCILIATION_VERSION,
      phase: 'pending',
      artifactSync: 'pending',
      lastCheckedAt: Date.now(),
      lastError: error instanceof Error ? error.message : 'Failed to read OpenClaw Transcript',
    });
  }

  settlement.backgroundIndex += 1;
  scheduleBackgroundRead(interactionId, settlement);
}

function beginSettlement(interaction: OwnedInteractionRecord, terminalAt: number, input?: { failure?: string; lateRecovery?: boolean }): void {
  const existing = monitors.get(interaction.id);
  if (existing?.settlement) return;
  const state: MonitorState = existing || { timer: null, startedAt: Date.now() };
  state.settlement = {
    terminalAt,
    lateRecovery: Boolean(input?.lateRecovery),
    foregroundIndex: 0,
    backgroundIndex: 0,
    previousFingerprint: null,
    stableReads: 0,
    best: null,
    ...(input?.failure ? { failure: input.failure } : {}),
  };
  monitors.set(interaction.id, state);
  getCanvasStore().updateReconciliationMetadata(interaction.id, {
    version: CANVAS_RECONCILIATION_VERSION,
    phase: 'settling',
    artifactSync: 'pending',
    terminalAt,
    lastCheckedAt: Date.now(),
    lastError: null,
  });
  scheduleNextSettlementRead(interaction, state.settlement);
}

async function pollInteraction(interactionId: string): Promise<void> {
  const interaction = getCanvasStore().getInteractionForReconciliation(interactionId);
  if (!interaction) {
    stopMonitor(interactionId);
    return;
  }
  const reconciliation = getReconciliation(interaction);
  if (interaction.status !== 'streaming') {
    if (reconciliation.version === CANVAS_RECONCILIATION_VERSION && reconciliation.artifactSync === 'synced') {
      stopMonitor(interactionId);
      return;
    }
    const terminalAt = asNumber(reconciliation.terminalAt) || interaction.updatedAt;
    beginSettlement(interaction, terminalAt, { lateRecovery: Date.now() - terminalAt > CANVAS_SETTLE_MAX_MS });
    return;
  }

  const age = Date.now() - interaction.createdAt;
  if (age >= MAX_MONITOR_AGE_MS) {
    getCanvasStore().updateReconciliationMetadata(interactionId, {
      version: CANVAS_RECONCILIATION_VERSION,
      phase: 'status_unconfirmed',
      artifactSync: 'pending',
      lastCheckedAt: Date.now(),
      lastError: 'OpenClaw Session status could not be confirmed within 24 hours',
    });
    stopMonitor(interactionId);
    return;
  }

  try {
    const response = await gatewayRpcCall('sessions.list', {
      activeMinutes: 7 * 24 * 60,
      limit: SESSION_LIST_LIMIT,
    }) as { sessions?: GatewaySessionSummary[] };
    const sessions = Array.isArray(response.sessions) ? response.sessions : [];
    const session = sessions.find((candidate) => sessionKeyOf(candidate) === interaction.sessionKey);
    getCanvasStore().updateReconciliationMetadata(interactionId, {
      version: CANVAS_RECONCILIATION_VERSION,
      phase: 'monitoring',
      artifactSync: 'pending',
      lastCheckedAt: Date.now(),
      lastError: null,
    });
    if (session && sessionIsTerminal(session)) {
      const terminalAt = session.updatedAt || Date.now();
      beginSettlement(interaction, terminalAt, {
        failure: sessionFailure(session),
        lateRecovery: Date.now() - terminalAt > CANVAS_SETTLE_MAX_MS,
      });
      return;
    }
  } catch (error) {
    getCanvasStore().updateReconciliationMetadata(interactionId, {
      version: CANVAS_RECONCILIATION_VERSION,
      phase: 'monitoring',
      artifactSync: 'pending',
      lastCheckedAt: Date.now(),
      lastError: error instanceof Error ? error.message : 'Gateway unavailable',
    });
  }

  trackTimer(interactionId, age >= SLOW_MONITOR_AFTER_MS ? 30_000 : 5_000, () => void pollInteraction(interactionId));
}

export function scheduleCanvasInteractionReconciliation(interactionId: string, delayMs = 3_000): void {
  const existing = monitors.get(interactionId);
  if (existing?.settlement) return;
  trackTimer(interactionId, delayMs, () => void pollInteraction(interactionId));
}

export function signalCanvasInteractionTerminal(interactionId: string, ownerId: string, failureHint?: string): OwnedInteractionRecord | null {
  const interaction = getCanvasStore().getOwnedInteraction(ownerId, interactionId);
  if (!interaction) return null;
  const reconciliation = getReconciliation(interaction);
  if (interaction.status !== 'streaming' && reconciliation.artifactSync === 'synced') return interaction;
  beginSettlement(interaction, Date.now(), failureHint ? { failure: failureHint } : undefined);
  return interaction;
}

export function startCanvasReconciler(): void {
  for (const interaction of getCanvasStore().listReconciliationCandidates()) {
    scheduleCanvasInteractionReconciliation(interaction.id, 0);
  }
}

export function stopCanvasReconciler(): void {
  for (const interactionId of [...monitors.keys()]) stopMonitor(interactionId);
}

export function canvasArtifactProxyUrl(uri: string): string {
  if (!uri.startsWith('/api/chat/media/')) return uri;
  return `/api/canvas/openclaw-artifact?uri=${encodeURIComponent(uri)}`;
}

export function resolveOpenClawArtifactUrl(uri: string): URL | null {
  if (!uri.startsWith('/api/chat/media/')) return null;
  const gatewayHttpUrl = config.gatewayUrl
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:')
    .replace(/\/ws\/?$/, '');
  return new URL(uri, gatewayHttpUrl.endsWith('/') ? gatewayHttpUrl : `${gatewayHttpUrl}/`);
}
