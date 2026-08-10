import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  type AgentProfile,
  type AgentRuntime,
  type ApprovalHandle,
  type ConversationHandle,
  type DispatchResult,
  type RuntimeArtifactCandidate,
  type RuntimeCapabilities,
  type RuntimeEvent,
  type RuntimeHandle,
  type RuntimeStatus,
  RuntimeOperationError,
  assertRuntimeHandle,
  runtimeHandle,
} from '../../contract.js';
import {
  collectOpenCodeTurnArtifacts,
  discardOpenCodeTurnFiles,
  materializeOpenCodeManagedArtifact,
  openCodeArtifactControlBlock,
  openCodeArtifactToken,
  prepareOpenCodeArtifactDirectory,
  releaseOpenCodeManagedArtifact,
  OPENCODE_ARTIFACT_MAX_BYTES,
} from './artifacts.js';
import {
  OpenCodeHttpError,
  OpenCodeServerClient,
  OpenCodeTransportError,
} from './server-client.js';

const OPENCODE_RUNTIME_ID = 'opencode';
const OPENCODE_PROFILE_ID = 'default';
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function array(value: unknown): UnknownRecord[] { return Array.isArray(value) ? value.map(record) : []; }

function sanitize(value: string): string {
  return value.slice(0, 4_000)
    .split(/\r?\n/)
    .filter((line) => !/^\s+at\s/.test(line))
    .join('\n')
    .replace(/((?:api[_-]?key|token|password|secret|authorization)\s*[=:]\s*)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[REDACTED]@');
}

let idCounter = 0;
function openCodeId(prefix: 'msg'): string {
  idCounter = (idCounter + 1) & 0xfff;
  let value = BigInt(Date.now()) * 0x1000n + BigInt(idCounter);
  let ordered = '';
  while (value > 0n) {
    ordered = BASE62[Number(value % 62n)] + ordered;
    value /= 62n;
  }
  ordered = ordered.padStart(14, '0').slice(-14);
  let random = '';
  for (const byte of randomBytes(12)) random += BASE62[byte % 62];
  return `${prefix}_${ordered}${random}`;
}

function conversationHandle(sessionId?: string, localConversationId?: string): ConversationHandle {
  return runtimeHandle(OPENCODE_RUNTIME_ID, {
    ...(sessionId ? { sessionId } : {}),
    ...(localConversationId ? { localConversationId } : {}),
  });
}

function turnHandle(sessionId: string, userMessageId: string, deliveryToken?: string): RuntimeHandle {
  return runtimeHandle(OPENCODE_RUNTIME_ID, {
    sessionId,
    userMessageId,
    ...(deliveryToken ? { deliveryToken } : {}),
  });
}

function openCodeCapabilities(): RuntimeCapabilities {
  return {
    conversation: { resume: true, readHistory: true, nativeFork: false },
    input: { text: true, images: true, audio: true, arbitraryFiles: true },
    output: { textStreaming: true, imageGeneration: 'supported', artifacts: true },
    execution: { interrupt: true, steer: false, interactiveApprovals: true },
    reliability: { idempotentDispatch: false, inspectAfterUnknownOutcome: true },
    usage: { turnTokens: true, contextWindow: true, accountUsage: false, accountQuota: false },
  };
}

function missing(error: unknown): boolean {
  return error instanceof OpenCodeHttpError && error.status === 404;
}

function messageInfo(value: UnknownRecord): UnknownRecord { return record(value.info); }
function messageParts(value: UnknownRecord): UnknownRecord[] { return array(value.parts); }
function messageId(value: UnknownRecord): string { return string(messageInfo(value).id); }
function messageRole(value: UnknownRecord): string { return string(messageInfo(value).role); }

function directAssistantMessages(messages: UnknownRecord[], userMessageId: string): UnknownRecord[] {
  return messages.filter((message) => {
    const info = messageInfo(message);
    return string(info.role) === 'assistant' && string(info.parentID) === userMessageId;
  });
}

function terminalAssistant(message: UnknownRecord): boolean {
  const info = messageInfo(message);
  return Boolean(number(record(info.time).completed) || string(info.finish))
    && string(info.finish).toLowerCase() !== 'tool-calls';
}

function assistantFailure(message: UnknownRecord): string {
  const error = record(messageInfo(message).error);
  return sanitize(string(error.message) || string(record(error.data).message) || string(error.name));
}

function textOf(message: UnknownRecord): string {
  return messageParts(message)
    .filter((part) => string(part.type) === 'text' && part.ignored !== true)
    .map((part) => string(part.text))
    .filter(Boolean)
    .join('');
}

function fileParts(message: UnknownRecord): UnknownRecord[] {
  return messageParts(message).flatMap((part) => {
    if (string(part.type) === 'file') return [part];
    if (string(part.type) !== 'tool') return [];
    const state = record(part.state);
    return string(state.status) === 'completed' ? array(state.attachments) : [];
  });
}

function fileCandidate(sessionId: string, part: UnknownRecord): RuntimeArtifactCandidate | null {
  const partId = string(part.id);
  const messageID = string(part.messageID);
  const url = string(part.url);
  if (!partId || !messageID || !url) return null;
  const sourceUri = `opencode-file:${sessionId}:${messageID}:${partId}`;
  return {
    name: string(part.filename) || `artifact-${partId}`,
    ...(string(part.mime) ? { mimeType: string(part.mime) } : {}),
    uri: sourceUri,
    sourceUri,
    storage: 'source',
    available: true,
    runtimeArtifactRef: runtimeHandle(OPENCODE_RUNTIME_ID, {
      kind: 'file-part', sessionId, messageId: messageID, partId,
    }),
  };
}

function eventData(event: UnknownRecord): UnknownRecord {
  return record(event.data || event.properties);
}

function eventId(event: UnknownRecord, fallback: string): string {
  return string(event.id) || fallback;
}

function approvalHandle(request: UnknownRecord): ApprovalHandle {
  return runtimeHandle(OPENCODE_RUNTIME_ID, {
    requestId: string(request.id),
    sessionId: string(request.sessionID),
    ...(string(record(request.tool).messageID) ? { messageId: string(record(request.tool).messageID) } : {}),
  });
}

function approvalCategory(permission: string): 'command' | 'network' | 'filesystem' | 'other' {
  const lower = permission.toLowerCase();
  if (/bash|command|exec/.test(lower)) return 'command';
  if (/network|fetch|web/.test(lower)) return 'network';
  if (/file|write|edit|patch|read/.test(lower)) return 'filesystem';
  return 'other';
}

function dataUriBytes(url: string): { bytes: Uint8Array; mimeType?: string } | null {
  const match = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const encoded = match[3] || '';
  if (encoded.length > Math.ceil(OPENCODE_ARTIFACT_MAX_BYTES * 4 / 3) + 4) {
    throw new Error('OpenCode FilePart exceeds 25 MiB');
  }
  const bytes = match[2] ? Buffer.from(encoded, 'base64') : Buffer.from(decodeURIComponent(encoded));
  if (bytes.byteLength > OPENCODE_ARTIFACT_MAX_BYTES) throw new Error('OpenCode FilePart exceeds 25 MiB');
  return { bytes, ...(match[1] ? { mimeType: match[1] } : {}) };
}

export function createOpenCodeAgentRuntime(client = new OpenCodeServerClient()): AgentRuntime {
  const runtimeEvents = new EventEmitter();
  const activeTurns = new Map<string, { userMessageId: string; deliveryToken: string }>();
  const turnFailures = new Map<string, { error: string; terminalAt: number }>();
  const pendingApprovals = new Map<string, UnknownRecord>();
  const contexts = new Map<string, { usedTokens: number; contextLimit: number; model?: string; provider?: string }>();
  let closed = false;

  const projectedStatus = (): RuntimeStatus => ({
    ...client.getStatus(),
    restartSupported: true,
    capabilities: openCodeCapabilities(),
  });

  const emit = (event: RuntimeEvent): void => { runtimeEvents.emit('event', event); };

  async function readMessages(sessionId: string): Promise<UnknownRecord[]> {
    return array(await client.request('GET', `/session/${encodeURIComponent(sessionId)}/message`, undefined, 20_000));
  }

  async function readMessage(sessionId: string, id: string): Promise<UnknownRecord> {
    return record(await client.request('GET', `/session/${encodeURIComponent(sessionId)}/message/${encodeURIComponent(id)}`, undefined, 15_000));
  }

  async function createSession(localConversationId: string): Promise<string> {
    const created = record(await client.request('POST', '/session', {
      title: 'ConvoSketchpad conversation',
      metadata: { convosketchpadConversationId: localConversationId },
    }, 20_000));
    const sessionId = string(created.id);
    if (!sessionId) throw new OpenCodeTransportError('OpenCode session creation returned no Session ID');
    return sessionId;
  }

  async function ensureSession(handle: ConversationHandle): Promise<string> {
    const sessionId = handle.opaque.sessionId;
    if (sessionId) {
      try {
        const session = record(await client.request('GET', `/session/${encodeURIComponent(sessionId)}`, undefined, 15_000));
        if (string(session.id)) return sessionId;
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    return createSession(handle.opaque.localConversationId || `local-${Date.now()}`);
  }

  async function updateContext(sessionId: string, assistants: UnknownRecord[]): Promise<void> {
    const terminal = [...assistants].reverse().find(terminalAssistant);
    if (!terminal) return;
    const info = messageInfo(terminal);
    const usedTokens = number(record(info.tokens).total);
    const providerId = string(info.providerID);
    const modelId = string(info.modelID);
    if (!providerId || !modelId) return;
    try {
      const providerResult = record(await client.request('GET', '/provider', undefined, 15_000));
      const provider = array(providerResult.all).find((candidate) => string(candidate.id) === providerId);
      const model = record(record(provider?.models)[modelId]);
      const contextLimit = number(record(model.limit).context);
      if (contextLimit > 0 && usedTokens >= 0 && usedTokens <= contextLimit) {
        contexts.set(sessionId, { usedTokens, contextLimit, model: modelId, provider: providerId });
      }
    } catch {
      // Context is optional and never blocks Turn completion.
    }
  }

  function projectApproval(request: UnknownRecord, nativeEventId?: string): void {
    const requestId = string(request.id);
    const sessionId = string(request.sessionID);
    if (!requestId || !sessionId) return;
    pendingApprovals.set(requestId, request);
    const permission = string(request.permission) || 'permission';
    const category = approvalCategory(permission);
    const patterns = Array.isArray(request.patterns) ? request.patterns.filter((item): item is string => typeof item === 'string') : [];
    const active = activeTurns.get(sessionId);
    emit({
      runtimeId: OPENCODE_RUNTIME_ID,
      type: 'approval.required',
      eventId: nativeEventId || `opencode:approval:${requestId}:required`,
      createdAt: Date.now(),
      conversationRef: conversationHandle(sessionId),
      ...(active ? { turnRef: turnHandle(sessionId, active.userMessageId, active.deliveryToken) } : {}),
      approvalRef: approvalHandle(request),
      approval: {
        category,
        title: category === 'command' ? 'Command execution requires approval'
          : category === 'network' ? 'Network access requires approval'
            : category === 'filesystem' ? 'File access requires approval'
              : 'OpenCode permission requires approval',
        ...(patterns.length ? { description: sanitize(patterns.join(', ')) } : {}),
        risk: category === 'filesystem' ? 'medium' : 'high',
        permissions: [{ id: permission, label: `Grant ${permission}`, risk: category === 'filesystem' ? 'medium' : 'high' }],
        choices: [
          { id: 'once', intent: 'grant', scope: 'item', label: 'Allow once', requiresConfirmation: false },
          { id: 'always', intent: 'grant', scope: 'session', label: 'Always allow for session', requiresConfirmation: true },
          { id: 'reject', intent: 'deny', scope: 'item', label: 'Deny', requiresConfirmation: false },
        ],
      },
    });
  }

  async function projectNativeEvent(event: UnknownRecord): Promise<void> {
    const type = string(event.type);
    const data = eventData(event);
    const sessionId = string(data.sessionID || record(data.info).sessionID || record(data.part).sessionID);
    const active = sessionId ? activeTurns.get(sessionId) : undefined;
    const refs = {
      ...(sessionId ? { conversationRef: conversationHandle(sessionId) } : {}),
      ...(sessionId && active ? { turnRef: turnHandle(sessionId, active.userMessageId, active.deliveryToken) } : {}),
    };
    const base = { runtimeId: OPENCODE_RUNTIME_ID, createdAt: Date.now(), ...refs };

    if (type === 'message.part.delta' && string(data.field) === 'text' && string(data.delta)) {
      emit({ ...base, type: 'output.text.delta', text: string(data.delta), messageId: string(data.messageID) || undefined });
      return;
    }
    if (type === 'message.part.updated') {
      const part = record(data.part);
      if (string(part.type) === 'text' && string(part.text)) {
        emit({ ...base, type: 'output.text.snapshot', text: string(part.text), messageId: string(part.messageID) || undefined });
      }
      const artifact = sessionId ? fileCandidate(sessionId, part) : null;
      if (artifact?.runtimeArtifactRef) {
        emit({ ...base, type: 'artifact.available', artifactRef: artifact.runtimeArtifactRef, name: artifact.name, mimeType: artifact.mimeType });
      }
      return;
    }
    if (type === 'message.updated') {
      const info = record(data.info);
      if (string(info.role) !== 'assistant' || !active || string(info.parentID) !== active.userMessageId) return;
      if (number(record(info.tokens).total)) {
        emit({ ...base, type: 'usage.updated', usedTokens: number(record(info.tokens).total) });
      }
      if (number(record(info.time).completed) || string(info.finish)) {
        const message = await readMessage(sessionId, string(info.id)).catch(() => ({ info, parts: [] }));
        const text = textOf(record(message));
        if (text) emit({ ...base, type: 'output.message.completed', text, messageId: string(info.id) });
        const failure = assistantFailure(record(message));
        if (failure) emit({ ...base, type: 'turn.failed', error: failure, eventId: eventId(event, `opencode:${sessionId}:${active.userMessageId}:failed`) });
        else if (terminalAssistant(record(message))) emit({ ...base, type: 'turn.completed', text, eventId: eventId(event, `opencode:${sessionId}:${active.userMessageId}:completed`) });
      }
      return;
    }
    if (type === 'session.idle' && sessionId && active) {
      const assistants = directAssistantMessages(await readMessages(sessionId), active.userMessageId);
      await updateContext(sessionId, assistants);
      const terminal = [...assistants].reverse().find(terminalAssistant);
      if (terminal) {
        const failure = assistantFailure(terminal);
        emit(failure
          ? { ...base, type: 'turn.failed', error: failure, eventId: eventId(event, `opencode:${sessionId}:${active.userMessageId}:failed`) }
          : { ...base, type: 'turn.completed', text: textOf(terminal), eventId: eventId(event, `opencode:${sessionId}:${active.userMessageId}:completed`) });
      }
      return;
    }
    if (type === 'session.error' && active) {
      const error = record(data.error);
      const message = sanitize(string(error.message) || string(record(error.data).message) || 'OpenCode session failed');
      turnFailures.set(`${sessionId}:${active.userMessageId}`, { error: message, terminalAt: Date.now() });
      emit({ ...base, type: 'turn.failed', error: message, eventId: eventId(event, `opencode:${sessionId}:${active.userMessageId}:failed`) });
      return;
    }
    if (type === 'permission.asked' || type === 'permission.v2.asked') {
      projectApproval(data, eventId(event, `opencode:approval:${string(data.id)}:required`));
      return;
    }
    if (type === 'permission.replied' || type === 'permission.v2.replied') {
      const requestId = string(data.requestID);
      const reply = string(data.reply);
      pendingApprovals.delete(requestId);
      emit({
        ...base,
        type: 'approval.resolved',
        eventId: eventId(event, `opencode:approval:${requestId}:resolved`),
        approvalRef: runtimeHandle(OPENCODE_RUNTIME_ID, { requestId, sessionId }),
        resolution: { choiceId: reply },
        resolvedBy: 'opencode',
      });
    }
  }

  const unsubscribeEvent = client.subscribeEvent((event) => { void projectNativeEvent(event).catch(() => undefined); });
  const unsubscribeNativeStatus = client.subscribeStatus(() => runtimeEvents.emit('status', projectedStatus()));

  const runtime: AgentRuntime = {
    id: OPENCODE_RUNTIME_ID,

    async describe() {
      await client.connect();
      return { id: OPENCODE_RUNTIME_ID, displayName: 'OpenCode', ...(client.getStatus().version ? { version: client.getStatus().version } : {}) };
    },

    async listAgentProfiles() {
      await client.connect();
      const providers = record(await client.request('GET', '/provider', undefined, 15_000));
      const connected = Array.isArray(providers.connected)
        ? providers.connected.filter((value): value is string => typeof value === 'string')
        : [];
      const defaults = record(providers.default);
      if (!connected.some((providerId) => Boolean(string(defaults[providerId])))) {
        throw new RuntimeOperationError('unavailable', 'OpenCode has no connected Provider with a default model');
      }
      const profiles: AgentProfile[] = [{
        runtimeId: OPENCODE_RUNTIME_ID,
        profileId: OPENCODE_PROFILE_ID,
        displayName: 'OpenCode',
        runtimeProfileRef: runtimeHandle(OPENCODE_RUNTIME_ID, { profile: OPENCODE_PROFILE_ID }),
        metadata: { defaultAgentAndModel: true, sharedHostAccount: true },
      }];
      return { defaultProfileId: OPENCODE_PROFILE_ID, profiles };
    },

    async getCapabilities(profile) {
      if (profile.runtimeId !== OPENCODE_RUNTIME_ID || profile.profileId !== OPENCODE_PROFILE_ID) {
        throw new RuntimeOperationError('validation', 'Unknown OpenCode Agent profile');
      }
      return openCodeCapabilities();
    },

    async inspectConversation(handle) {
      assertRuntimeHandle(handle, OPENCODE_RUNTIME_ID);
      const sessionId = handle.opaque.sessionId;
      if (!sessionId) return { exists: false, conversationRef: handle };
      try {
        const session = record(await client.request('GET', `/session/${encodeURIComponent(sessionId)}`, undefined, 15_000));
        const context = contexts.get(sessionId);
        return {
          exists: Boolean(string(session.id)),
          conversationRef: conversationHandle(sessionId, handle.opaque.localConversationId),
          instanceId: sessionId,
          ...(number(record(session.time).created) ? { startedAt: number(record(session.time).created) } : {}),
          ...(context ? { context } : {}),
        };
      } catch (error) {
        if (missing(error)) return { exists: false, conversationRef: handle };
        throw error;
      }
    },

    async prepareConversation(handle) {
      const snapshot = await runtime.inspectConversation(handle);
      return snapshot?.exists ? { outcome: 'continued' } : { outcome: 'recreated', reason: 'opencode_session_missing' };
    },

    createConversationHandle({ profile, localConversationId }) {
      if (profile.runtimeId !== OPENCODE_RUNTIME_ID || profile.profileId !== OPENCODE_PROFILE_ID) {
        throw new RuntimeOperationError('validation', 'OpenCode received a foreign Agent profile');
      }
      return conversationHandle(undefined, localConversationId);
    },

    async dispatchTurn(input): Promise<DispatchResult> {
      assertRuntimeHandle(input.conversationRef, OPENCODE_RUNTIME_ID);
      const userMessageId = openCodeId('msg');
      const prepared = await prepareOpenCodeArtifactDirectory(input.idempotencyKey);
      let sessionId = input.conversationRef.opaque.sessionId || '';
      try {
        sessionId = await ensureSession(input.conversationRef);
        activeTurns.set(sessionId, { userMessageId, deliveryToken: prepared.token });
        await client.request('POST', `/session/${encodeURIComponent(sessionId)}/prompt_async`, {
          messageID: userMessageId,
          tools: { question: false },
          parts: [
            { type: 'text', text: input.message },
            ...input.attachments.map((attachment) => ({
              type: 'file',
              mime: attachment.mimeType,
              filename: attachment.fileName || attachment.name || 'attachment',
              url: `data:${attachment.mimeType};base64,${attachment.content}`,
            })),
            { type: 'text', text: openCodeArtifactControlBlock(prepared), synthetic: true },
          ],
        }, input.timeoutMs || 30_000);
        return {
          outcome: 'accepted',
          conversationRef: conversationHandle(sessionId, input.conversationRef.opaque.localConversationId),
          conversationInstanceId: sessionId,
          turnRef: turnHandle(sessionId, userMessageId, prepared.token),
        };
      } catch (error) {
        if (error instanceof OpenCodeHttpError) {
          activeTurns.delete(sessionId);
          await discardOpenCodeTurnFiles(prepared.token);
          return { outcome: 'rejected', error: new RuntimeOperationError('rejected', sanitize(error.message), error) };
        }
        return {
          outcome: 'unknown',
          error: new RuntimeOperationError('unknown_outcome', sanitize(error instanceof Error ? error.message : 'OpenCode dispatch outcome is unknown'), error),
          recoveryRef: runtimeHandle(OPENCODE_RUNTIME_ID, {
            kind: 'dispatch-recovery',
            ...(sessionId ? { sessionId } : {}),
            userMessageId,
            deliveryToken: prepared.token,
            localConversationId: input.conversationRef.opaque.localConversationId || '',
          }),
        };
      }
    },

    async reconcileDispatch(input) {
      const recovery = input.recoveryRef;
      if (!recovery) return { outcome: 'not_found' };
      assertRuntimeHandle(recovery, OPENCODE_RUNTIME_ID);
      let sessionId = recovery.opaque.sessionId;
      try {
        if (!sessionId && recovery.opaque.localConversationId) {
          const sessions = array(await client.request('GET', '/session?limit=100', undefined, 20_000));
          const match = sessions.find((session) => string(record(session.metadata).convosketchpadConversationId) === recovery.opaque.localConversationId);
          sessionId = string(match?.id);
        }
        if (!sessionId) return { outcome: 'not_found' };
        const userMessageId = recovery.opaque.userMessageId;
        try {
          await readMessage(sessionId, userMessageId);
        } catch (error) {
          if (missing(error)) return { outcome: 'not_found' };
          throw error;
        }
        const token = recovery.opaque.deliveryToken || openCodeArtifactToken(input.idempotencyKey);
        activeTurns.set(sessionId, { userMessageId, deliveryToken: token });
        return {
          outcome: 'accepted',
          conversationRef: conversationHandle(sessionId, input.conversationRef.opaque.localConversationId),
          conversationInstanceId: sessionId,
          turnRef: turnHandle(sessionId, userMessageId, token),
        };
      } catch (error) {
        return {
          outcome: 'unknown',
          error: new RuntimeOperationError('unknown_outcome', sanitize(error instanceof Error ? error.message : 'OpenCode dispatch reconciliation failed'), error),
          recoveryRef: recovery,
        };
      }
    },

    async readTurn(input) {
      assertRuntimeHandle(input.conversationRef, OPENCODE_RUNTIME_ID);
      if (input.turnRef) assertRuntimeHandle(input.turnRef, OPENCODE_RUNTIME_ID);
      const sessionId = input.turnRef?.opaque.sessionId || input.conversationRef.opaque.sessionId;
      const userMessageId = input.turnRef?.opaque.userMessageId;
      if (!sessionId || !userMessageId) {
        return { agentOutput: '', artifacts: [], matchedTurn: false, artifactDiscoveryComplete: false, artifactWarnings: [] };
      }
      const messages = await readMessages(sessionId);
      const persistedUserMessage = messages.some((message) => messageId(message) === userMessageId && messageRole(message) === 'user');
      const rememberedFailure = turnFailures.get(`${sessionId}:${userMessageId}`);
      if (!persistedUserMessage && !rememberedFailure) {
        return { agentOutput: '', artifacts: [], matchedTurn: false, instanceId: sessionId, artifactDiscoveryComplete: false, artifactWarnings: [] };
      }
      const assistants = directAssistantMessages(messages, userMessageId);
      const terminal = Boolean(rememberedFailure) || assistants.some(terminalAssistant);
      await updateContext(sessionId, assistants);
      const nativeArtifacts = assistants.flatMap((message) => fileParts(message)
        .flatMap((part) => {
          const candidate = fileCandidate(sessionId, part);
          return candidate ? [candidate] : [];
        }));
      const token = input.turnRef?.opaque.deliveryToken || activeTurns.get(sessionId)?.deliveryToken;
      const managed = terminal && token
        ? await collectOpenCodeTurnArtifacts(token, Boolean(rememberedFailure) || assistants.some((message) => Boolean(assistantFailure(message))))
        : { artifacts: [], warnings: [] };
      return {
        agentOutput: assistants.map(textOf).filter(Boolean).join('\n'),
        artifacts: [...nativeArtifacts, ...managed.artifacts],
        matchedTurn: true,
        instanceId: sessionId,
        artifactDiscoveryComplete: terminal,
        artifactWarnings: managed.warnings,
      };
    },

    async inspectTurn(input) {
      assertRuntimeHandle(input.conversationRef, OPENCODE_RUNTIME_ID);
      if (input.turnRef) assertRuntimeHandle(input.turnRef, OPENCODE_RUNTIME_ID);
      const sessionId = input.turnRef?.opaque.sessionId || input.conversationRef.opaque.sessionId;
      const userMessageId = input.turnRef?.opaque.userMessageId;
      if (!sessionId || !userMessageId) return { found: false, terminal: false, reflectsTurn: false };
      try {
        const messages = await readMessages(sessionId);
        const found = messages.some((message) => messageId(message) === userMessageId && messageRole(message) === 'user');
        const rememberedFailure = turnFailures.get(`${sessionId}:${userMessageId}`);
        if (!found && !rememberedFailure) return { found: false, terminal: false, reflectsTurn: false, instanceId: sessionId };
        if (rememberedFailure) return {
          found: true,
          terminal: true,
          reflectsTurn: true,
          instanceId: sessionId,
          terminalAt: rememberedFailure.terminalAt,
          failure: rememberedFailure.error,
        };
        const assistants = directAssistantMessages(messages, userMessageId);
        const final = [...assistants].reverse().find(terminalAssistant);
        const failure = assistants.map(assistantFailure).find(Boolean);
        return {
          found: true,
          terminal: Boolean(final || failure),
          reflectsTurn: true,
          instanceId: sessionId,
          ...(final ? { terminalAt: number(record(messageInfo(final).time).completed) || undefined } : {}),
          ...(failure ? { failure } : {}),
        };
      } catch (error) {
        if (missing(error)) return { found: false, terminal: false, reflectsTurn: false };
        throw error;
      }
    },

    async resolveApproval({ approvalRef, resolution }) {
      assertRuntimeHandle(approvalRef, OPENCODE_RUNTIME_ID);
      const requestId = approvalRef.opaque.requestId;
      if (!requestId || !['once', 'always', 'reject'].includes(resolution.choiceId)) {
        return { outcome: 'rejected', error: new RuntimeOperationError('validation', 'Unsupported OpenCode approval choice') };
      }
      try {
        if (!pendingApprovals.has(requestId)) {
          const requests = array(await client.request('GET', '/permission', undefined, 15_000));
          const pending = requests.find((request) => string(request.id) === requestId);
          if (!pending) return { outcome: 'unknown', error: new RuntimeOperationError('unknown_outcome', 'OpenCode approval is no longer pending') };
          pendingApprovals.set(requestId, pending);
        }
        const pending = pendingApprovals.get(requestId)!;
        const permission = string(pending.permission);
        if (resolution.choiceId !== 'reject' && resolution.grantedPermissionIds) {
          const granted = [...new Set(resolution.grantedPermissionIds)];
          if (granted.length !== 1 || granted[0] !== permission) {
            return { outcome: 'rejected', error: new RuntimeOperationError('validation', 'OpenCode permissions cannot be partially granted') };
          }
        }
        await client.request('POST', `/permission/${encodeURIComponent(requestId)}/reply`, { reply: resolution.choiceId }, 15_000);
        pendingApprovals.delete(requestId);
        return { outcome: 'accepted', resolution };
      } catch (error) {
        const operationError = new RuntimeOperationError(
          error instanceof OpenCodeTransportError ? 'unknown_outcome' : 'rejected',
          sanitize(error instanceof Error ? error.message : 'OpenCode approval failed'),
          error,
        );
        return operationError.kind === 'unknown_outcome'
          ? { outcome: 'unknown', error: operationError }
          : { outcome: 'rejected', error: operationError };
      }
    },

    async materializeArtifact(handle) {
      assertRuntimeHandle(handle, OPENCODE_RUNTIME_ID);
      if (handle.opaque.kind === 'managed-file') return materializeOpenCodeManagedArtifact(handle);
      if (handle.opaque.kind === 'source') {
        const data = dataUriBytes(handle.opaque.sourceUri || '');
        if (data) return data;
        if (/^https?:\/\//i.test(handle.opaque.sourceUri || '')) return { externalUrl: handle.opaque.sourceUri, ...(handle.opaque.mimeType ? { mimeType: handle.opaque.mimeType } : {}) };
        throw new RuntimeOperationError('unsupported', 'Unsupported OpenCode Artifact source URI');
      }
      if (handle.opaque.kind !== 'file-part') throw new RuntimeOperationError('unsupported', 'Unsupported OpenCode Artifact handle');
      const message = await readMessage(handle.opaque.sessionId, handle.opaque.messageId);
      const part = fileParts(message).find((candidate) => string(candidate.id) === handle.opaque.partId);
      const url = string(part?.url);
      const data = dataUriBytes(url);
      if (data) return { ...data, ...(string(part?.mime) ? { mimeType: string(part?.mime) } : {}) };
      if (/^https?:\/\//i.test(url)) return { externalUrl: url, ...(string(part?.mime) ? { mimeType: string(part?.mime) } : {}) };
      throw new RuntimeOperationError('unsupported', 'OpenCode FilePart URL cannot be materialized safely');
    },

    async releaseArtifact(handle) {
      if (handle.opaque.kind === 'managed-file') await releaseOpenCodeManagedArtifact(handle);
    },

    createArtifactHandle({ sourceUri, conversationRef, mimeType }) {
      assertRuntimeHandle(conversationRef, OPENCODE_RUNTIME_ID);
      return runtimeHandle(OPENCODE_RUNTIME_ID, { kind: 'source', sourceUri, ...(mimeType ? { mimeType } : {}) });
    },

    async readUsageSummary() {
      throw new RuntimeOperationError('unsupported', 'OpenCode account usage is not available through this Adapter');
    },

    async readProviderQuotas() { return { available: false, providers: [] }; },

    async restart() {
      await client.restart();
      return { output: 'OpenCode Server restarted' };
    },

    getStatus: projectedStatus,

    subscribeEvents(listener) {
      runtimeEvents.on('event', listener);
      return () => runtimeEvents.off('event', listener);
    },

    subscribeStatus(listener) {
      runtimeEvents.on('status', listener);
      listener(projectedStatus());
      void client.connect().catch(() => runtimeEvents.emit('status', projectedStatus()));
      return () => runtimeEvents.off('status', listener);
    },

    close() {
      if (closed) return;
      closed = true;
      unsubscribeEvent();
      unsubscribeNativeStatus();
      client.close();
      runtimeEvents.removeAllListeners();
    },
  };

  return runtime;
}
