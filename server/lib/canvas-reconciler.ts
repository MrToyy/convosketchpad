import { createHash } from 'node:crypto';
import {
  CANVAS_ARTIFACT_MAX_BYTES,
  cleanupOrphanCanvasArtifacts,
  materializeCanvasArtifacts,
  persistCanvasArtifactBytes,
} from './canvas-artifact-store.js';
import { mergeEquivalentArtifacts } from './canvas-artifact-identity.js';
import {
  evaluateArtifactWatch,
  terminalArtifactSync,
} from './canvas-artifact-watch.js';
import {
  buildReconciledInteractionUpdate,
  type ReconciliationFinishInput,
} from './canvas-reconciliation-state.js';
import {
  captureInteractionCompletionSession,
  type InteractionCompletionSession,
} from './canvas-context-snapshot.js';
import { config } from './config.js';
import {
  getCanvasStore,
  type CanvasArtifact,
  type InteractionRecord,
  type OwnedInteractionRecord,
} from './canvas-db.js';
import {
  gatewayRpcCall,
  gatewaySupports,
  GatewayRpcError,
  getGatewaySharedHttpAuthToken,
} from './gateway-rpc.js';
import { publishCanvasChanged } from './canvas-sync.js';

export const CANVAS_SETTLE_MIN_MS = 4_000;
export const CANVAS_SETTLE_MAX_MS = 15_000;

const FOREGROUND_OFFSETS_MS = [500, 1_500, 3_000, 4_000, 6_000, 9_000, 12_000, 15_000];
const BACKGROUND_OFFSETS_MS = [30_000, 60_000, 120_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const MAX_MONITOR_AGE_MS = 24 * 60 * 60 * 1_000;
const SLOW_MONITOR_AFTER_MS = 60 * 60 * 1_000;
const SESSION_LIST_LIMIT = 1_000;

type GatewayMessage = Record<string, unknown>;

export interface GatewaySessionSummary {
  key?: string;
  sessionKey?: string;
  id?: string;
  sessionId?: string;
  status?: string;
  error?: string;
  agentState?: string;
  busy?: boolean;
  processing?: boolean;
  updatedAt?: number;
  startedAt?: number | string;
  endedAt?: number | string;
}

export interface CanvasTranscriptSnapshot {
  agentOutput: string;
  artifacts: CanvasArtifact[];
  fingerprint: string;
  matchedInteraction: boolean;
  sessionId?: string;
  artifactPersistenceComplete?: boolean;
  artifactWarnings?: string[];
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

interface ReconciliationView {
  phase?: unknown;
  artifactSync?: unknown;
  artifactWarnings?: unknown;
  lastError?: unknown;
}

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

function pickInteractionMessages(messages: GatewayMessage[], interaction: InteractionRecord): {
  messages: GatewayMessage[];
  matchedInteraction: boolean;
} {
  if (messages.length === 0) return { messages: [], matchedInteraction: false };
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
    if (runIndexes.length > 0) return {
      messages: runIndexes.map((index) => messages[index]),
      matchedInteraction: true,
    };
  }

  if (userIndex < 0) return { messages: messages.slice(-20), matchedInteraction: false };
  let endIndex = messages.length;
  for (let index = userIndex + 1; index < messages.length; index += 1) {
    if (getMessageRole(messages[index]) === 'user') {
      endIndex = index;
      break;
    }
  }
  return { messages: messages.slice(userIndex, endIndex), matchedInteraction: true };
}

export function extractCanvasTranscript(messages: GatewayMessage[], interaction: InteractionRecord): CanvasTranscriptSnapshot {
  const picked = pickInteractionMessages(messages, interaction);
  const relevant = picked.messages;
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
  return { agentOutput, artifacts: artifactList, fingerprint, matchedInteraction: picked.matchedInteraction };
}

export function canvasTranscriptHasResponse(snapshot: CanvasTranscriptSnapshot | null | undefined): boolean {
  return Boolean(snapshot?.matchedInteraction
    && (snapshot.agentOutput.trim().length > 0 || snapshot.artifacts.length > 0));
}

function getReconciliation(interaction: InteractionRecord): Record<string, unknown> {
  return asRecord(interaction.sessionMetadata.reconciliation) || {};
}

export function interactionHasPendingUpdates(interaction: InteractionRecord): boolean {
  return interaction.executionState === 'running'
    || interaction.executionState === 'unconfirmed'
    || interaction.artifactSyncState === 'observing';
}

function reconciliationView(interaction: InteractionRecord): ReconciliationView {
  const reconciliation = getReconciliation(interaction);
  return {
    phase: reconciliation.phase,
    artifactSync: reconciliation.artifactSync,
    artifactWarnings: reconciliation.artifactWarnings,
    lastError: reconciliation.lastError,
  };
}

function artifactsEqual(left: CanvasArtifact[], right: CanvasArtifact[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reconciliationViewEqual(left: InteractionRecord, right: InteractionRecord): boolean {
  return JSON.stringify(reconciliationView(left)) === JSON.stringify(reconciliationView(right));
}

export function compareReconciledInteractions(
  before: InteractionRecord,
  after: InteractionRecord,
): {
  statusChanged: boolean;
  outputChanged: boolean;
  artifactChanged: boolean;
  reconciliationChanged: boolean;
  graphChanged: boolean;
} {
  const statusChanged = after.executionState !== before.executionState;
  const outputChanged = after.agentOutput !== before.agentOutput;
  const artifactChanged = !artifactsEqual(after.artifacts, before.artifacts);
  const reconciliationChanged = !reconciliationViewEqual(after, before);
  return {
    statusChanged,
    outputChanged,
    artifactChanged,
    reconciliationChanged,
    graphChanged: after.version !== before.version || statusChanged || outputChanged || artifactChanged,
  };
}

function sessionKeyOf(session: GatewaySessionSummary): string {
  return session.sessionKey || session.key || '';
}

export function sessionIsTerminal(session: GatewaySessionSummary): boolean {
  const status = session.status?.toLowerCase();
  if (status === 'done' || status === 'completed' || status === 'error' || status === 'failed' || status === 'aborted') return true;
  return session.agentState === 'idle' && !session.busy && !session.processing;
}

function timestampValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function sessionTerminalAt(session: GatewaySessionSummary): number | undefined {
  return timestampValue(session.endedAt) ?? timestampValue(session.updatedAt);
}

export function sessionReflectsInteractionRun(session: GatewaySessionSummary, interaction: InteractionRecord): boolean {
  const terminalAt = sessionTerminalAt(session);
  if (terminalAt !== undefined && terminalAt >= interaction.createdAt + 250) return true;
  const startedAt = timestampValue(session.startedAt);
  return startedAt !== undefined && startedAt >= interaction.createdAt - 250;
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

function trackArtifactTimer(interactionId: string, delayMs: number, fn: () => void): void {
  const boundedDelay = Math.max(0, delayMs);
  getCanvasStore().scheduleArtifactSyncAttempt(interactionId, Date.now() + boundedDelay);
  trackTimer(interactionId, boundedDelay, fn);
}

function stopMonitor(interactionId: string): void {
  const state = monitors.get(interactionId);
  if (state?.timer) clearTimeout(state.timer);
  monitors.delete(interactionId);
}

interface NativeArtifactSummary {
  id: string;
  title?: string;
  mimeType?: string;
  sizeBytes?: number;
}

function nativeArtifactScopeUnavailable(error: unknown): boolean {
  if (error instanceof GatewayRpcError && error.code === 'artifact_scope_not_found') return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('no session found for artifact query');
}

function gatewayHttpBase(): URL {
  const gatewayUrl = config.gatewayUrl
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:')
    .replace(/\/ws\/?$/, '');
  return new URL(gatewayUrl.endsWith('/') ? gatewayUrl : `${gatewayUrl}/`);
}

async function boundedResponseBytes(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new Error('Artifact response has no body');
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > CANVAS_ARTIFACT_MAX_BYTES) throw new Error('Artifact exceeds the 25 MiB persistence limit');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > CANVAS_ARTIFACT_MAX_BYTES) {
      await reader.cancel();
      throw new Error('Artifact exceeds the 25 MiB persistence limit');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function downloadGatewayArtifactUrl(urlValue: string): Promise<{
  bytes?: Uint8Array;
  mimeType?: string;
  externalUrl?: string;
}> {
  const base = gatewayHttpBase();
  const target = new URL(urlValue, base);
  if (target.origin !== base.origin) return { externalUrl: target.toString() };
  const token = getGatewaySharedHttpAuthToken();
  const response = await fetch(target, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`OpenClaw Artifact returned HTTP ${response.status}`);
  return {
    bytes: await boundedResponseBytes(response),
    mimeType: response.headers.get('content-type') || undefined,
  };
}

export function mergeArtifacts(artifacts: CanvasArtifact[]): CanvasArtifact[] {
  return mergeEquivalentArtifacts(artifacts);
}

async function readNativeArtifacts(interaction: OwnedInteractionRecord): Promise<{
  artifacts: CanvasArtifact[];
  complete: boolean;
  warnings: string[];
}> {
  if (!gatewaySupports('artifacts.list') || !gatewaySupports('artifacts.download')) {
    return {
      artifacts: [],
      complete: false,
      warnings: ['OpenClaw Gateway does not advertise artifacts.list/download; Artifact sync requires a Gateway upgrade.'],
    };
  }

  const query = interaction.runId
    ? { runId: interaction.runId, agentId: interaction.agentId }
    : { sessionKey: interaction.sessionKey, agentId: interaction.agentId };
  let summaries: NativeArtifactSummary[];
  try {
    const listed = await gatewayRpcCall('artifacts.list', query, 30_000) as {
      artifacts?: NativeArtifactSummary[];
    };
    summaries = Array.isArray(listed.artifacts)
      ? listed.artifacts.filter((item) => typeof item?.id === 'string')
      : [];
  } catch (error) {
    // Completed runs may no longer have a Gateway run→session lookup. The
    // Interaction-scoped transcript extractor remains the safe fallback;
    // querying the whole Session here could attach older artifacts.
    if (interaction.runId && nativeArtifactScopeUnavailable(error)) {
      return {
        artifacts: [],
        complete: true,
        warnings: [],
      };
    }
    return {
      artifacts: [],
      complete: false,
      warnings: [`OpenClaw Artifact listing failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const artifacts: CanvasArtifact[] = [];
  const warnings: string[] = [];
  for (const summary of summaries) {
    const name = summary.title || summary.id;
    const sourceKey = `openclaw-artifact:${interaction.agentId}:${summary.id}`;
    const baseArtifact: CanvasArtifact = {
      gatewayArtifactId: summary.id,
      name,
      uri: sourceKey,
      sourceUri: sourceKey,
      ...(summary.mimeType ? { mimeType: summary.mimeType } : {}),
      ...(typeof summary.sizeBytes === 'number' ? { sizeBytes: summary.sizeBytes } : {}),
    };
    try {
      const downloaded = await gatewayRpcCall('artifacts.download', {
        ...query,
        artifactId: summary.id,
      }, 30_000) as {
        artifact?: NativeArtifactSummary;
        encoding?: unknown;
        data?: unknown;
        url?: unknown;
      };
      const mimeType = downloaded.artifact?.mimeType || summary.mimeType;
      if (downloaded.encoding === 'base64' && typeof downloaded.data === 'string') {
        artifacts.push(await persistCanvasArtifactBytes(
          interaction,
          baseArtifact,
          sourceKey,
          Buffer.from(downloaded.data, 'base64'),
          mimeType,
        ));
        continue;
      }
      if (typeof downloaded.url === 'string') {
        const resolved = await downloadGatewayArtifactUrl(downloaded.url);
        if (resolved.externalUrl) {
          artifacts.push({
            ...baseArtifact,
            uri: resolved.externalUrl,
            sourceUri: resolved.externalUrl,
            storage: 'external',
            available: true,
          });
        } else if (resolved.bytes) {
          artifacts.push(await persistCanvasArtifactBytes(
            interaction,
            baseArtifact,
            sourceKey,
            resolved.bytes,
            mimeType || resolved.mimeType,
          ));
        }
        continue;
      }
      throw new Error('Gateway returned an unsupported Artifact download payload');
    } catch (error) {
      const warning = `${name}: ${error instanceof Error ? error.message : 'Artifact download failed'}`;
      warnings.push(warning);
      artifacts.push({
        ...baseArtifact,
        storage: 'source',
        available: false,
        warning,
      });
    }
  }
  return { artifacts, complete: warnings.length === 0, warnings };
}

export async function reconcileTranscriptSnapshot(
  interaction: OwnedInteractionRecord,
): Promise<CanvasTranscriptSnapshot> {
  const response = await gatewayRpcCall('sessions.get', {
    key: interaction.sessionKey,
    limit: 500,
    includeTools: true,
  }, 15_000) as { messages?: GatewayMessage[]; id?: string; sessionId?: string };
  const sessionId = response.sessionId || response.id;
  if (sessionId) getCanvasStore().observeBranchSession(interaction.branchId, sessionId);
  const extracted = extractCanvasTranscript(Array.isArray(response.messages) ? response.messages : [], interaction);
  const native = await readNativeArtifacts(interaction);
  const fallbackArtifacts = extracted.artifacts.filter((artifact) => !native.artifacts.some((candidate) =>
    candidate.name === artifact.name
    && (!candidate.mimeType || !artifact.mimeType || candidate.mimeType === artifact.mimeType)
    && (candidate.sizeBytes === undefined || artifact.sizeBytes === undefined || candidate.sizeBytes === artifact.sizeBytes)));
  const extractedSources = new Set(fallbackArtifacts.map((artifact) => artifact.sourceUri || artifact.uri));
  const retainedArtifacts = interaction.artifacts.filter((artifact) =>
    !extractedSources.has(artifact.sourceUri || artifact.uri)
    && !native.artifacts.some((candidate) =>
      candidate.gatewayArtifactId && candidate.gatewayArtifactId === artifact.gatewayArtifactId));
  const materialized = await materializeCanvasArtifacts(interaction, [...fallbackArtifacts, ...retainedArtifacts]);
  const artifacts = mergeArtifacts([...native.artifacts, ...materialized.artifacts]);
  const warnings = [
    ...native.warnings,
    ...artifacts.flatMap((artifact) => artifact.warning ? [artifact.warning] : []),
  ];
  return {
    ...extracted,
    artifacts,
    ...(sessionId ? { sessionId } : {}),
    artifactPersistenceComplete: native.complete && warnings.length === 0,
    artifactWarnings: warnings,
    fingerprint: createHash('sha256')
      .update(JSON.stringify({ agentOutput: extracted.agentOutput, artifacts }))
      .digest('hex'),
  };
}

async function captureSessionBeforeCompletion(
  interaction: OwnedInteractionRecord,
  snapshot: CanvasTranscriptSnapshot | null,
): Promise<InteractionCompletionSession | undefined> {
  if (interaction.executionState !== 'running' && interaction.executionState !== 'unconfirmed') {
    return undefined;
  }
  try {
    return await captureInteractionCompletionSession(
      interaction.sessionKey,
      snapshot?.sessionId || interaction.observedSessionId || interaction.openClawSessionId || undefined,
    ) || undefined;
  } catch {
    return undefined;
  }
}

interface ReconciliationCompletionInput extends ReconciliationFinishInput {
  completionSessionId?: string;
}

function finish(
  interaction: OwnedInteractionRecord,
  snapshot: CanvasTranscriptSnapshot | null,
  input: ReconciliationCompletionInput,
): void {
  const { completionSessionId, ...reconciliationInput } = input;
  const updated = getCanvasStore().applyReconciledInteraction(
    interaction.id,
    buildReconciledInteractionUpdate(interaction, snapshot, reconciliationInput),
  );
  if (updated) {
    const { graphChanged } = compareReconciledInteractions(interaction, updated);
    const adopted = completionSessionId
      ? getCanvasStore().adoptRecoveredInteractionSession(
        interaction.id,
        completionSessionId,
        reconciliationInput.contextSnapshot?.capturedAt,
      )
      : null;
    if (graphChanged || adopted) {
      publishCanvasChanged(interaction.ownerId, interaction.canvasId);
    }
  }
}

function scheduleNextSettlementRead(interaction: OwnedInteractionRecord, state: SettlementState): void {
  const now = Date.now();
  const elapsed = now - state.terminalAt;
  if (state.lateRecovery) {
    trackArtifactTimer(interaction.id, state.foregroundIndex === 0 ? 0 : 1_000, () => void settlementRead(interaction.id));
    return;
  }
  const offset = FOREGROUND_OFFSETS_MS.find((candidate) => candidate >= elapsed && candidate >= FOREGROUND_OFFSETS_MS[state.foregroundIndex]);
  trackArtifactTimer(
    interaction.id,
    Math.max(0, (offset ?? CANVAS_SETTLE_MAX_MS) - elapsed),
    () => void settlementRead(interaction.id),
  );
}

function nextBackgroundIndex(elapsed: number): number {
  const index = BACKGROUND_OFFSETS_MS.findIndex((offset) => offset > elapsed);
  return index >= 0 ? index : BACKGROUND_OFFSETS_MS.length - 1;
}

async function settlementRead(interactionId: string): Promise<void> {
  const state = monitors.get(interactionId);
  const settlement = state?.settlement;
  const interaction = getCanvasStore().getInteractionForReconciliation(interactionId);
  if (!state || !settlement || !interaction) {
    stopMonitor(interactionId);
    return;
  }
  getCanvasStore().markArtifactSyncAttempt(interactionId);

  let readError: string | undefined;
  try {
    const snapshot = await reconcileTranscriptSnapshot(interaction);
    settlement.best = snapshot;
    if (snapshot.fingerprint === settlement.previousFingerprint) settlement.stableReads += 1;
    else settlement.stableReads = 1;
    settlement.previousFingerprint = snapshot.fingerprint;
  } catch (error) {
    readError = error instanceof Error ? error.message : 'Failed to read OpenClaw Transcript';
  }

  const now = Date.now();
  const elapsed = now - settlement.terminalAt;
  const currentReconciliation = getReconciliation(interaction);
  getCanvasStore().updateReconciliationMetadata(interactionId, {
    phase: interaction.executionState === 'running' || interaction.executionState === 'unconfirmed'
      ? 'settling'
      : currentReconciliation.phase || 'pending',
    artifactSync: 'pending',
    terminalAt: settlement.terminalAt,
    lastCheckedAt: now,
    ...(readError ? { lastError: readError } : { lastError: null }),
  });

  if (settlement.failure) {
    const artifactWatch = evaluateArtifactWatch(
      settlement.best,
      elapsed,
      elapsed >= BACKGROUND_OFFSETS_MS[BACKGROUND_OFFSETS_MS.length - 1],
    );
    finish(interaction, settlement.best, {
      status: 'failed',
      artifactSync: artifactWatch.artifactSync,
      terminalAt: settlement.terminalAt,
      executionError: settlement.failure,
      reconciliationError: readError,
    });
    if (artifactWatch.stop) {
      stopMonitor(interactionId);
      return;
    }
    settlement.backgroundIndex = nextBackgroundIndex(elapsed);
    scheduleBackgroundRead(interaction.id, settlement);
    return;
  }

  if (settlement.lateRecovery) {
    const artifactWatch = evaluateArtifactWatch(
      settlement.best,
      elapsed,
      elapsed >= BACKGROUND_OFFSETS_MS[BACKGROUND_OFFSETS_MS.length - 1],
    );
    if (artifactWatch.stop) {
      const completionSession = canvasTranscriptHasResponse(settlement.best)
        ? await captureSessionBeforeCompletion(interaction, settlement.best)
        : undefined;
      finish(interaction, settlement.best, {
        artifactSync: artifactWatch.artifactSync,
        terminalAt: settlement.terminalAt,
        reconciliationError: readError,
        ...(completionSession?.contextSnapshot
          ? { contextSnapshot: completionSession.contextSnapshot }
          : {}),
        ...(completionSession ? { completionSessionId: completionSession.sessionId } : {}),
      });
      stopMonitor(interactionId);
      return;
    }
    if (canvasTranscriptHasResponse(settlement.best)) {
      const completionSession = await captureSessionBeforeCompletion(interaction, settlement.best);
      finish(interaction, settlement.best, {
        artifactSync: 'pending',
        terminalAt: settlement.terminalAt,
        reconciliationError: readError,
        ...(completionSession?.contextSnapshot
          ? { contextSnapshot: completionSession.contextSnapshot }
          : {}),
        ...(completionSession ? { completionSessionId: completionSession.sessionId } : {}),
      });
    }
    settlement.backgroundIndex = nextBackgroundIndex(elapsed);
    scheduleBackgroundRead(interaction.id, settlement);
    return;
  }

  settlement.foregroundIndex += 1;
  let responsePersisted = false;
  if (elapsed >= CANVAS_SETTLE_MIN_MS
    && settlement.stableReads >= 2
    && canvasTranscriptHasResponse(settlement.best)) {
    const completionSession = await captureSessionBeforeCompletion(interaction, settlement.best);
    finish(interaction, settlement.best, {
      artifactSync: 'pending',
      terminalAt: settlement.terminalAt,
      reconciliationError: readError,
      ...(completionSession?.contextSnapshot
        ? { contextSnapshot: completionSession.contextSnapshot }
        : {}),
      ...(completionSession ? { completionSessionId: completionSession.sessionId } : {}),
    });
    responsePersisted = true;
  }

  if (elapsed >= CANVAS_SETTLE_MAX_MS) {
    if (canvasTranscriptHasResponse(settlement.best)
      && !responsePersisted) {
      const completionSession = await captureSessionBeforeCompletion(interaction, settlement.best);
      finish(interaction, settlement.best, {
        artifactSync: 'pending',
        terminalAt: settlement.terminalAt,
        reconciliationError: readError,
        ...(completionSession?.contextSnapshot
          ? { contextSnapshot: completionSession.contextSnapshot }
          : {}),
        ...(completionSession ? { completionSessionId: completionSession.sessionId } : {}),
      });
    } else if (!canvasTranscriptHasResponse(settlement.best)) {
      getCanvasStore().updateReconciliationMetadata(interactionId, {
        phase: 'awaiting_response',
        artifactSync: 'pending',
        terminalAt: settlement.terminalAt,
        lastCheckedAt: now,
        lastError: readError || null,
      });
    }
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
    if (interaction) finish(interaction, settlement.best, {
      artifactSync: terminalArtifactSync(settlement.best),
      terminalAt: settlement.terminalAt,
    });
    stopMonitor(interactionId);
    return;
  }
  trackArtifactTimer(
    interactionId,
    Math.max(0, settlement.terminalAt + offset - Date.now()),
    () => void backgroundRead(interactionId),
  );
}

async function backgroundRead(interactionId: string): Promise<void> {
  const state = monitors.get(interactionId);
  const settlement = state?.settlement;
  const interaction = getCanvasStore().getInteractionForReconciliation(interactionId);
  if (!state || !settlement || !interaction) {
    stopMonitor(interactionId);
    return;
  }
  getCanvasStore().markArtifactSyncAttempt(interactionId);

  try {
    const snapshot = await reconcileTranscriptSnapshot(interaction);
    settlement.best = snapshot;
    settlement.previousFingerprint = snapshot.fingerprint;
    const finalAttempt = settlement.backgroundIndex === BACKGROUND_OFFSETS_MS.length - 1;
    const artifactWatch = evaluateArtifactWatch(
      snapshot,
      Date.now() - settlement.terminalAt,
      finalAttempt,
    );
    if (artifactWatch.stop) {
      finish(interaction, snapshot, {
        artifactSync: artifactWatch.artifactSync,
        terminalAt: settlement.terminalAt,
      });
      stopMonitor(interactionId);
      return;
    }
    if (canvasTranscriptHasResponse(snapshot)) {
      finish(interaction, snapshot, {
        artifactSync: 'pending',
        terminalAt: settlement.terminalAt,
      });
    } else {
      getCanvasStore().updateReconciliationMetadata(interactionId, {
        phase: 'awaiting_response',
        artifactSync: 'pending',
        terminalAt: settlement.terminalAt,
        lastCheckedAt: Date.now(),
        lastError: null,
      });
    }
  } catch (error) {
    const finalAttempt = settlement.backgroundIndex === BACKGROUND_OFFSETS_MS.length - 1;
    if (finalAttempt) {
      finish(interaction, settlement.best, {
        artifactSync: 'degraded',
        terminalAt: settlement.terminalAt,
        reconciliationError: error instanceof Error ? error.message : 'Failed to read OpenClaw Transcript',
      });
      stopMonitor(interactionId);
      return;
    }
    getCanvasStore().updateReconciliationMetadata(interactionId, {
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
  const preserveTerminalArtifactState = Boolean(
    input?.lateRecovery
    && (interaction.artifactSyncState === 'synced' || interaction.artifactSyncState === 'degraded'),
  );
  getCanvasStore().updateInteractionCoordination(interaction.id, {
    artifactSyncState: preserveTerminalArtifactState ? interaction.artifactSyncState : 'observing',
    artifactObservationPending: true,
    terminalAt,
    error: input?.failure || null,
  });
  getCanvasStore().updateReconciliationMetadata(interaction.id, {
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
  if (interaction.executionState !== 'running' && interaction.executionState !== 'unconfirmed') {
    if (!getCanvasStore().hasArtifactSyncJob(interactionId)) {
      stopMonitor(interactionId);
      return;
    }
    const terminalAt = asNumber(reconciliation.terminalAt) || interaction.updatedAt;
    beginSettlement(interaction, terminalAt, { lateRecovery: Date.now() - terminalAt > CANVAS_SETTLE_MAX_MS });
    return;
  }

  const age = Date.now() - interaction.createdAt;
  if (age >= MAX_MONITOR_AGE_MS) {
    const updated = getCanvasStore().updateInteractionCoordination(interactionId, {
      executionState: 'unconfirmed',
      artifactSyncState: 'degraded',
      error: 'OpenClaw Session status could not be confirmed within 24 hours',
    });
    getCanvasStore().updateReconciliationMetadata(interactionId, {
      phase: 'status_unconfirmed',
      artifactSync: 'pending',
      lastCheckedAt: Date.now(),
      lastError: 'OpenClaw Session status could not be confirmed within 24 hours',
    });
    if (updated) {
      publishCanvasChanged(interaction.ownerId, interaction.canvasId);
    }
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
    const sessionId = session?.sessionId || session?.id;
    if (sessionId) getCanvasStore().observeBranchSession(interaction.branchId, sessionId);
    getCanvasStore().updateReconciliationMetadata(interactionId, {
      phase: 'monitoring',
      artifactSync: 'pending',
      lastCheckedAt: Date.now(),
      lastError: null,
    });
    if (session && sessionIsTerminal(session) && sessionReflectsInteractionRun(session, interaction)) {
      const terminalAt = sessionTerminalAt(session) || Date.now();
      beginSettlement(interaction, terminalAt, {
        failure: sessionFailure(session),
        lateRecovery: Date.now() - terminalAt > CANVAS_SETTLE_MAX_MS,
      });
      return;
    }

    if (asNumber(reconciliation.terminalHintAt)) {
      const snapshot = await reconcileTranscriptSnapshot(interaction);
      if (canvasTranscriptHasResponse(snapshot)) {
        beginSettlement(interaction, Date.now(), {
          failure: typeof reconciliation.failureHint === 'string' ? reconciliation.failureHint : undefined,
        });
        return;
      }
    }
  } catch (error) {
    getCanvasStore().updateReconciliationMetadata(interactionId, {
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

export function signalCanvasInteractionTerminal(interactionId: string, ownerId: string, input?: {
  runId?: string;
  failureHint?: string;
}): OwnedInteractionRecord | null {
  const interaction = getCanvasStore().getOwnedInteraction(ownerId, interactionId);
  if (!interaction) return null;
  if (input?.runId && interaction.runId && input.runId !== interaction.runId) return interaction;
  if (interaction.executionState !== 'running' && interaction.executionState !== 'unconfirmed'
    && !getCanvasStore().hasArtifactSyncJob(interaction.id)) return interaction;
  const updated = getCanvasStore().updateReconciliationMetadata(interaction.id, {
    phase: 'terminal_hint_received',
    artifactSync: 'pending',
    terminalHintAt: Date.now(),
    terminalHintRunId: input?.runId || interaction.runId || null,
    failureHint: input?.failureHint || null,
    lastCheckedAt: Date.now(),
  });
  getCanvasStore().updateInteractionCoordination(interaction.id, {
    artifactSyncState: 'observing',
    terminalAt: Date.now(),
    error: input?.failureHint || null,
  });
  publishCanvasChanged(interaction.ownerId, interaction.canvasId);
  scheduleCanvasInteractionReconciliation(interaction.id, 0);
  return updated ? getCanvasStore().getOwnedInteraction(ownerId, interaction.id) : interaction;
}

export function startCanvasReconciler(): void {
  void cleanupOrphanCanvasArtifacts((canvasId) => getCanvasStore().canvasExists(canvasId))
    .catch((error) => console.warn('[canvas] Artifact orphan cleanup failed:', error instanceof Error ? error.message : error));
  rescanCanvasReconciliationCandidates();
}

export function rescanCanvasReconciliationCandidates(): void {
  const batchSize = 500;
  for (let offset = 0; ; offset += batchSize) {
    const batch = getCanvasStore().listReconciliationCandidates(batchSize, offset);
    for (const interaction of batch) {
      scheduleCanvasInteractionReconciliation(interaction.id, 0);
    }
    if (batch.length < batchSize) break;
  }
}

export function stopCanvasReconciler(): void {
  for (const interactionId of [...monitors.keys()]) stopMonitor(interactionId);
}

export {
  artifactSyncStateDuringObservation,
  evaluateArtifactWatch,
} from './canvas-artifact-watch.js';
