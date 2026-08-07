import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  type AgentProfile,
  type AgentRuntime,
  type ApprovalChoice,
  type ApprovalHandle,
  type ConversationHandle,
  type DispatchResult,
  type RuntimeArtifactCandidate,
  type RuntimeCapabilities,
  type RuntimeEvent,
  type RuntimeHandle,
  type RuntimeProviderQuota,
  type RuntimeStatus,
  RuntimeOperationError,
  assertRuntimeHandle,
  runtimeHandle,
} from '../../contract.js';
import {
  CodexAppServerClient,
  CodexRpcError,
  CodexTransportError,
  type CodexServerRequest,
} from './app-server-client.js';
import {
  CODEX_ARTIFACT_MAX_BYTES,
  CODEX_ARTIFACT_DEVELOPER_INSTRUCTIONS,
  codexArtifactControlBlock,
  collectCodexTurnArtifacts,
  discardCodexTurnFiles,
  managedArtifactToken,
  materializeCodexManagedArtifact,
  prepareCodexTurnFiles,
  releaseCodexManagedArtifact,
} from './artifacts.js';
import { codexConfig } from './config.js';

const CODEX_RUNTIME_ID = 'codex';
const CODEX_PROFILE_ID = 'default';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function conversationHandle(threadId?: string, localConversationId?: string): ConversationHandle {
  return runtimeHandle(CODEX_RUNTIME_ID, {
    ...(threadId ? { threadId } : {}),
    ...(localConversationId ? { localConversationId } : {}),
  });
}

function turnHandle(threadId: string, turnId: string, deliveryToken?: string): RuntimeHandle {
  return runtimeHandle(CODEX_RUNTIME_ID, {
    threadId,
    turnId,
    ...(deliveryToken ? { deliveryToken } : {}),
  });
}

function codexCapabilities(): RuntimeCapabilities {
  return {
    conversation: { resume: true, readHistory: true, nativeFork: false },
    input: { text: true, images: true, audio: false, arbitraryFiles: false },
    output: { textStreaming: true, imageGeneration: 'supported', artifacts: true },
    execution: { interrupt: true, steer: false, interactiveApprovals: true },
    reliability: { idempotentDispatch: false, inspectAfterUnknownOutcome: true },
    usage: { turnTokens: true, contextWindow: true, accountUsage: true, accountQuota: true },
  };
}

function rpcMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('not found') || message.includes('no rollout') || message.includes('unknown thread');
}

function sanitize(value: string): string {
  return value
    .slice(0, 4_000)
    .replace(/(authorization\s*:\s*bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[REDACTED]@');
}

function statusOfTurn(turn: UnknownRecord): string {
  return string(turn.status).toLowerCase();
}

function terminalStatus(status: string): boolean {
  return ['completed', 'failed', 'interrupted', 'cancelled', 'canceled'].includes(status);
}

function itemText(item: UnknownRecord): string {
  if (typeof item.text === 'string') return item.text;
  if (typeof item.content === 'string') return item.content;
  if (Array.isArray(item.content)) {
    return item.content.map((part) => string(record(part).text || record(part).content)).join('');
  }
  return '';
}

function turnItems(turn: UnknownRecord): UnknownRecord[] {
  return Array.isArray(turn.items) ? turn.items.map(record) : [];
}

function threadTurns(result: unknown): UnknownRecord[] {
  const thread = record(record(result).thread);
  return Array.isArray(thread.turns) ? thread.turns.map(record) : [];
}

function approvalChoices(includeSession = true): ApprovalChoice[] {
  return [
    { id: 'accept', intent: 'grant', scope: 'item', label: 'Allow once', requiresConfirmation: false },
    ...(includeSession ? [{ id: 'acceptForSession', intent: 'grant' as const, scope: 'session' as const, label: 'Allow for session', requiresConfirmation: true }] : []),
    { id: 'decline', intent: 'deny', scope: 'item', label: 'Deny', requiresConfirmation: false },
    { id: 'cancel', intent: 'deny', scope: 'turn', label: 'Deny and stop turn', requiresConfirmation: true },
  ];
}

interface PendingApproval {
  request: CodexServerRequest;
  handle: ApprovalHandle;
}

function approvalKey(handle: RuntimeHandle): string {
  return `${handle.opaque.method}:${handle.opaque.requestId}`;
}

function nativeImageCandidate(threadId: string, turnId: string, item: UnknownRecord): RuntimeArtifactCandidate | null {
  const itemId = string(item.id);
  if (!itemId || string(item.type) !== 'imageGeneration' || !string(item.result)) return null;
  const sourceUri = `codex-image:${threadId}:${turnId}:${itemId}`;
  return {
    name: `generated-${itemId}.png`,
    mimeType: 'image/png',
    uri: sourceUri,
    sourceUri,
    storage: 'source',
    available: true,
    runtimeArtifactRef: runtimeHandle(CODEX_RUNTIME_ID, { kind: 'image-generation', threadId, turnId, itemId }),
  };
}

function extractImageBytes(result: string): Uint8Array {
  const match = result.match(/^data:([^;,]+);base64,(.+)$/s);
  const encoded = match ? match[2] : result;
  if (encoded.length > Math.ceil(CODEX_ARTIFACT_MAX_BYTES * 4 / 3) + 4) {
    throw new Error('Codex generated image exceeds 25 MiB');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.byteLength > CODEX_ARTIFACT_MAX_BYTES) throw new Error('Codex generated image exceeds 25 MiB');
  return bytes;
}

export function createCodexAgentRuntime(client = new CodexAppServerClient()): AgentRuntime {
  const runtimeEvents = new EventEmitter();
  const pendingApprovals = new Map<string, PendingApproval>();
  const deliveryTokens = new Map<string, string>();
  const threadContexts = new Map<string, { usedTokens: number; contextLimit: number }>();
  let authenticated: boolean | null = null;
  let accountPlan: string | null = null;
  let closed = false;

  const projectedStatus = (): RuntimeStatus => {
    const native = client.getStatus();
    if (native.state === 'connected' && authenticated === false) {
      return {
        ...native,
        state: 'disconnected',
        error: 'Codex is not logged in; run `codex login` and restart ConvoSketchpad',
        restartSupported: true,
        capabilities: codexCapabilities(),
        diagnostics: { authenticated: false },
      };
    }
    return {
      ...native,
      restartSupported: true,
      capabilities: codexCapabilities(),
      diagnostics: { authenticated },
    };
  };

  const emit = (event: RuntimeEvent): void => {
    runtimeEvents.emit('event', event);
  };

  async function refreshAccount(): Promise<void> {
    const result = record(await client.request('account/read', { refreshToken: false }, 10_000));
    const account = record(result.account);
    const requiresAuth = result.requiresOpenaiAuth === true;
    authenticated = !requiresAuth || Object.keys(account).length > 0;
    accountPlan = string(account.planType) || null;
    runtimeEvents.emit('status', projectedStatus());
  }

  async function readThread(threadId: string, includeTurns = true): Promise<unknown> {
    return client.request('thread/read', { threadId, includeTurns }, 15_000);
  }

  async function ensureThread(handle: ConversationHandle): Promise<string> {
    const existing = handle.opaque.threadId;
    if (existing) {
      try {
        const result = record(await client.request('thread/resume', {
          threadId: existing,
          cwd: codexConfig.workingDirectory,
          developerInstructions: CODEX_ARTIFACT_DEVELOPER_INSTRUCTIONS,
        }, 20_000));
        const resumed = string(record(result.thread).id);
        if (resumed) return resumed;
      } catch (error) {
        if (!rpcMissing(error)) throw error;
      }
    }
    const result = record(await client.request('thread/start', {
      cwd: codexConfig.workingDirectory,
      developerInstructions: CODEX_ARTIFACT_DEVELOPER_INSTRUCTIONS,
      ephemeral: false,
    }, 20_000));
    const created = string(record(result.thread).id);
    if (!created) throw new CodexTransportError('Codex thread/start returned no thread id');
    return created;
  }

  async function projectNotification(method: string, params: UnknownRecord): Promise<void> {
    const threadId = string(params.threadId || record(params.thread).id);
    const turn = record(params.turn);
    const turnId = string(params.turnId || turn.id);
    const deliveryToken = deliveryTokens.get(`${threadId}:${turnId}`);
    const refs = {
      ...(threadId ? { conversationRef: conversationHandle(threadId) } : {}),
      ...(threadId && turnId ? { turnRef: turnHandle(threadId, turnId, deliveryToken) } : {}),
    };
    const base = { runtimeId: CODEX_RUNTIME_ID, createdAt: Date.now(), ...refs };
    if (method === 'turn/started' && turnId) {
      emit({ ...base, type: 'turn.accepted', eventId: `codex:${threadId}:${turnId}:started` });
      return;
    }
    if (method === 'item/agentMessage/delta') {
      const text = string(params.delta);
      const messageId = string(params.itemId);
      if (text) emit({ ...base, type: 'output.text.delta', text, ...(messageId ? { messageId } : {}) });
      return;
    }
    if (method === 'item/completed') {
      const item = record(params.item);
      if (string(item.type) === 'agentMessage') {
        const text = itemText(item);
        const messageId = string(item.id || params.itemId);
        if (text) emit({ ...base, type: 'output.message.completed', text, ...(messageId ? { messageId } : {}) });
      }
      const image = threadId && turnId ? nativeImageCandidate(threadId, turnId, item) : null;
      if (image?.runtimeArtifactRef) {
        emit({ ...base, type: 'artifact.available', artifactRef: image.runtimeArtifactRef, name: image.name, mimeType: image.mimeType });
      }
      return;
    }
    if (method === 'thread/tokenUsage/updated') {
      const usage = record(params.tokenUsage);
      // `total` is cumulative Thread billing usage and can exceed the model's
      // context window. `last` describes the most recent model invocation and
      // is the value that can be compared with modelContextWindow.
      const usedTokens = number(record(usage.last).totalTokens);
      const contextLimit = number(usage.modelContextWindow);
      if (threadId && contextLimit > 0) threadContexts.set(threadId, { usedTokens, contextLimit });
      emit({
        ...base,
        type: 'usage.updated',
        usedTokens,
        ...(contextLimit ? { contextLimit } : {}),
      });
      return;
    }
    if (method === 'turn/completed') {
      const status = statusOfTurn(turn);
      const error = string(record(turn.error).message) || `Codex turn ${status || 'failed'}`;
      if (status === 'completed') emit({ ...base, type: 'turn.completed', eventId: `codex:${threadId}:${turnId}:completed` });
      else if (status === 'interrupted' || status === 'cancelled' || status === 'canceled') {
        emit({ ...base, type: 'turn.interrupted', error, eventId: `codex:${threadId}:${turnId}:interrupted` });
      } else emit({ ...base, type: 'turn.failed', error, eventId: `codex:${threadId}:${turnId}:failed` });
      return;
    }
    if (method === 'account/updated') {
      authenticated = Boolean(params.authMode);
      accountPlan = string(params.planType) || null;
      runtimeEvents.emit('status', projectedStatus());
    }
  }

  function projectApproval(request: CodexServerRequest): RuntimeEvent | null {
    const params = request.params;
    const threadId = string(params.threadId);
    const turnId = string(params.turnId);
    if (!threadId || !turnId) return null;
    const method = request.method;
    const requestId = String(request.id);
    const handle = runtimeHandle(CODEX_RUNTIME_ID, {
      method,
      requestId,
      threadId,
      turnId,
      itemId: string(params.itemId),
    });
    pendingApprovals.set(approvalKey(handle), { request, handle });
    const isCommand = method === 'item/commandExecution/requestApproval';
    const isFile = method === 'item/fileChange/requestApproval';
    const isPermissions = method === 'item/permissions/requestApproval';
    if (!isCommand && !isFile && !isPermissions) return null;
    const network = record(params.networkApprovalContext);
    const category = Object.keys(network).length ? 'network' : isCommand ? 'command' : isFile ? 'filesystem' : 'other';
    const description = sanitize(
      string(params.reason)
      || (Object.keys(network).length ? `${string(network.protocol) || 'network'}://${string(network.host)}` : '')
      || (isCommand ? string(params.command) : ''),
    );
    const requestedPermissions = isPermissions ? record(params.permissions) : {};
    const permissionKeys = Object.keys(requestedPermissions);
    const permissions = permissionKeys.length
      ? permissionKeys.map((id) => ({ id, label: `Grant ${id} permission`, risk: 'high' as const }))
      : [{
        id: category === 'command' ? 'execute-command' : category === 'filesystem' ? 'modify-files' : category === 'network' ? 'access-network' : 'grant-permissions',
        label: category === 'command' ? 'Execute this command' : category === 'filesystem' ? 'Modify files' : category === 'network' ? 'Access the requested network destination' : 'Grant requested permissions',
        risk: category === 'network' || category === 'command' ? 'high' as const : 'medium' as const,
      }];
    return {
      runtimeId: CODEX_RUNTIME_ID,
      type: 'approval.required',
      eventId: `codex:approval:${method}:${requestId}:required`,
      createdAt: Date.now(),
      conversationRef: conversationHandle(threadId),
      turnRef: turnHandle(threadId, turnId, deliveryTokens.get(`${threadId}:${turnId}`)),
      approvalRef: handle,
      approval: {
        category,
        title: category === 'command' ? 'Command execution requires approval'
          : category === 'filesystem' ? 'File changes require approval'
            : category === 'network' ? 'Network access requires approval'
              : 'Codex permissions require approval',
        ...(description ? { description } : {}),
        risk: category === 'filesystem' ? 'medium' : 'high',
        permissions,
        choices: approvalChoices(),
      },
    };
  }

  const unsubscribeNotification = client.subscribeNotification((method, params) => {
    void projectNotification(method, params).catch(() => undefined);
  });
  const unsubscribeRequest = client.subscribeServerRequest((request) => {
    if (request.method === 'item/tool/requestUserInput') {
      emit({
        runtimeId: CODEX_RUNTIME_ID,
        type: 'input.required',
        createdAt: Date.now(),
        conversationRef: conversationHandle(string(request.params.threadId)),
        turnRef: turnHandle(string(request.params.threadId), string(request.params.turnId)),
        prompt: 'Codex requested structured user input, which is unavailable in Default mode',
      });
      client.respondError(request.id, -32601, 'Structured user input is unsupported by this integration');
      return;
    }
    if (request.method === 'mcpServer/elicitation/request') {
      client.respond(request.id, { action: 'decline', content: null });
      return;
    }
    const event = projectApproval(request);
    if (event) emit(event);
    else client.respondError(request.id, -32601, `Unsupported Codex server request: ${request.method}`);
  });
  const unsubscribeNativeStatus = client.subscribeStatus(() => runtimeEvents.emit('status', projectedStatus()));

  const runtime: AgentRuntime = {
    id: CODEX_RUNTIME_ID,

    async describe() {
      await client.connect();
      await refreshAccount().catch(() => undefined);
      return { id: CODEX_RUNTIME_ID, displayName: 'Codex', ...(client.getStatus().version ? { version: client.getStatus().version } : {}) };
    },

    async listAgentProfiles() {
      await client.connect();
      await refreshAccount();
      if (authenticated === false) {
        throw new RuntimeOperationError('unavailable', 'Codex is not logged in; run `codex login` and restart ConvoSketchpad');
      }
      const profiles: AgentProfile[] = [{
        runtimeId: CODEX_RUNTIME_ID,
        profileId: CODEX_PROFILE_ID,
        displayName: 'Codex',
        runtimeProfileRef: runtimeHandle(CODEX_RUNTIME_ID, { profile: CODEX_PROFILE_ID }),
        metadata: { sharedHostAccount: true },
      }];
      return { defaultProfileId: CODEX_PROFILE_ID, profiles };
    },

    async getCapabilities(profile) {
      if (profile.runtimeId !== CODEX_RUNTIME_ID || profile.profileId !== CODEX_PROFILE_ID) {
        throw new RuntimeOperationError('validation', 'Unknown Codex Agent profile');
      }
      return codexCapabilities();
    },

    async inspectConversation(handle) {
      assertRuntimeHandle(handle, CODEX_RUNTIME_ID);
      const threadId = handle.opaque.threadId;
      if (!threadId) return { exists: false, conversationRef: handle };
      try {
        const result = record(await readThread(threadId, false));
        const thread = record(result.thread);
        return {
          exists: Boolean(string(thread.id)),
          conversationRef: conversationHandle(threadId),
          instanceId: threadId,
          ...(number(thread.createdAt) ? { startedAt: number(thread.createdAt) * (number(thread.createdAt) < 10_000_000_000 ? 1_000 : 1) } : {}),
          ...(threadContexts.has(threadId) ? { context: threadContexts.get(threadId)! } : {}),
        };
      } catch (error) {
        if (rpcMissing(error)) return { exists: false, conversationRef: handle };
        throw error;
      }
    },

    async prepareConversation(handle) {
      const snapshot = await runtime.inspectConversation(handle);
      return snapshot?.exists
        ? { outcome: 'continued' }
        : { outcome: 'recreated', reason: 'codex_thread_missing' };
    },

    createConversationHandle({ profile, localConversationId }) {
      if (profile.runtimeId !== CODEX_RUNTIME_ID) throw new RuntimeOperationError('validation', 'Codex received a foreign profile');
      return conversationHandle(undefined, localConversationId);
    },

    async dispatchTurn(input): Promise<DispatchResult> {
      assertRuntimeHandle(input.conversationRef, CODEX_RUNTIME_ID);
      const threadId = await ensureThread(input.conversationRef);
      const prepared = await prepareCodexTurnFiles(input.idempotencyKey, input.attachments);
      let baseline: UnknownRecord[] = [];
      try {
        baseline = threadTurns(await readThread(threadId, true));
      } catch {
        // The new thread can be readable only after its first persisted item.
      }
      try {
        const result = record(await client.request('turn/start', {
          threadId,
          clientUserMessageId: input.idempotencyKey,
          cwd: codexConfig.workingDirectory,
          input: [
            { type: 'text', text: input.message },
            ...prepared.inputItems,
            { type: 'text', text: codexArtifactControlBlock(prepared) },
          ],
        }, input.timeoutMs || 30_000));
        const turnId = string(record(result.turn).id);
        if (!turnId) throw new CodexTransportError('Codex turn/start returned no turn id');
        deliveryTokens.set(`${threadId}:${turnId}`, prepared.token);
        return {
          outcome: 'accepted',
          conversationRef: conversationHandle(threadId),
          conversationInstanceId: threadId,
          turnRef: turnHandle(threadId, turnId, prepared.token),
        };
      } catch (error) {
        if (error instanceof CodexRpcError) {
          await discardCodexTurnFiles(prepared.token);
          return { outcome: 'rejected', error: new RuntimeOperationError('rejected', error.message, error) };
        }
        return {
          outcome: 'unknown',
          error: new RuntimeOperationError('unknown_outcome', error instanceof Error ? error.message : 'Codex dispatch outcome is unknown', error),
          recoveryRef: runtimeHandle(CODEX_RUNTIME_ID, {
            kind: 'dispatch-recovery',
            threadId,
            deliveryToken: prepared.token,
            baselineCount: String(baseline.length),
            baselineLastTurnId: string(baseline.at(-1)?.id),
            messageHash: createHash('sha256').update(input.message).digest('hex'),
          }),
        };
      }
    },

    async reconcileDispatch(input) {
      const recovery = input.recoveryRef;
      if (!recovery) return { outcome: 'not_found' };
      assertRuntimeHandle(recovery, CODEX_RUNTIME_ID);
      const threadId = recovery.opaque.threadId;
      if (!threadId) return { outcome: 'not_found' };
      try {
        const result = await readThread(threadId, true);
        const turns = threadTurns(result);
        const baselineCount = Number(recovery.opaque.baselineCount || 0);
        const token = recovery.opaque.deliveryToken || managedArtifactToken(input.idempotencyKey);
        const candidates = turns.slice(Math.max(0, baselineCount));
        const matched = candidates.find((turn) => JSON.stringify(turn).includes(token));
        if (matched && string(matched.id)) {
          const turnId = string(matched.id);
          deliveryTokens.set(`${threadId}:${turnId}`, token);
          return {
            outcome: 'accepted',
            conversationRef: conversationHandle(threadId),
            conversationInstanceId: threadId,
            turnRef: turnHandle(threadId, turnId, token),
          };
        }
        const thread = record(record(result).thread);
        const state = string(record(thread.status).type || thread.status).toLowerCase();
        if (state.includes('active') || state.includes('running')) {
          return {
            outcome: 'unknown',
            error: new RuntimeOperationError('unknown_outcome', 'Codex Thread is still active and dispatch cannot yet be reconciled'),
            recoveryRef: recovery,
          };
        }
        return { outcome: 'not_found' };
      } catch (error) {
        if (rpcMissing(error)) return { outcome: 'not_found' };
        return {
          outcome: 'unknown',
          error: new RuntimeOperationError('unknown_outcome', error instanceof Error ? error.message : 'Codex dispatch reconciliation failed', error),
          recoveryRef: recovery,
        };
      }
    },

    async readTurn(input) {
      assertRuntimeHandle(input.conversationRef, CODEX_RUNTIME_ID);
      if (input.turnRef) assertRuntimeHandle(input.turnRef, CODEX_RUNTIME_ID);
      const threadId = input.turnRef?.opaque.threadId || input.conversationRef.opaque.threadId;
      const turnId = input.turnRef?.opaque.turnId;
      if (!threadId || !turnId) {
        return { agentOutput: '', artifacts: [], matchedTurn: false, artifactDiscoveryComplete: false, artifactWarnings: [] };
      }
      const result = await readThread(threadId, true);
      const turn = threadTurns(result).find((candidate) => string(candidate.id) === turnId);
      if (!turn) return { agentOutput: '', artifacts: [], matchedTurn: false, instanceId: threadId, artifactDiscoveryComplete: false, artifactWarnings: [] };
      const status = statusOfTurn(turn);
      const completed = terminalStatus(status);
      const output = turnItems(turn)
        .filter((item) => string(item.type) === 'agentMessage')
        .map(itemText)
        .filter(Boolean)
        .join('\n');
      const token = input.turnRef?.opaque.deliveryToken || deliveryTokens.get(`${threadId}:${turnId}`);
      const prefix = token ? `${codexConfig.workingDirectory}/.convosketchpad-artifacts/${token}/outputs/` : '';
      const sanitizedOutput = prefix
        ? output
          .replace(new RegExp(`\\[([^\\]]+)\\]\\(${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^)]+\\)`, 'g'), '$1')
          .split(prefix).join('')
        : output;
      const nativeArtifacts = turnItems(turn).flatMap((item) => {
        const candidate = nativeImageCandidate(threadId, turnId, item);
        return candidate ? [candidate] : [];
      });
      const managed = completed && token
        ? await collectCodexTurnArtifacts(token, status !== 'completed')
        : { artifacts: [], warnings: [] };
      return {
        agentOutput: sanitizedOutput,
        artifacts: [...nativeArtifacts, ...managed.artifacts],
        matchedTurn: true,
        instanceId: threadId,
        artifactDiscoveryComplete: completed,
        artifactWarnings: managed.warnings,
      };
    },

    async inspectTurn(input) {
      assertRuntimeHandle(input.conversationRef, CODEX_RUNTIME_ID);
      if (input.turnRef) assertRuntimeHandle(input.turnRef, CODEX_RUNTIME_ID);
      const threadId = input.turnRef?.opaque.threadId || input.conversationRef.opaque.threadId;
      const turnId = input.turnRef?.opaque.turnId;
      if (!threadId || !turnId) return { found: false, terminal: false, reflectsTurn: false };
      try {
        const turn = threadTurns(await readThread(threadId, true)).find((candidate) => string(candidate.id) === turnId);
        if (!turn) return { found: false, terminal: false, reflectsTurn: false };
        const status = statusOfTurn(turn);
        return {
          found: true,
          terminal: terminalStatus(status),
          reflectsTurn: true,
          instanceId: threadId,
          ...(status === 'failed' ? { failure: string(record(turn.error).message) || 'Codex turn failed' } : {}),
        };
      } catch (error) {
        if (rpcMissing(error)) return { found: false, terminal: false, reflectsTurn: false };
        throw error;
      }
    },

    async resolveApproval({ approvalRef, resolution }) {
      assertRuntimeHandle(approvalRef, CODEX_RUNTIME_ID);
      const pending = pendingApprovals.get(approvalKey(approvalRef));
      if (!pending) {
        return { outcome: 'unknown', error: new RuntimeOperationError('unknown_outcome', 'Codex approval is no longer pending') };
      }
      const { request } = pending;
      try {
        if (request.method === 'item/permissions/requestApproval') {
          const requested = record(request.params.permissions);
          const granted = new Set(resolution.grantedPermissionIds || Object.keys(requested));
          const permissions = resolution.choiceId === 'accept' || resolution.choiceId === 'acceptForSession'
            ? Object.fromEntries(Object.entries(requested).filter(([key]) => granted.has(key)))
            : {};
          client.respond(request.id, {
            permissions,
            scope: resolution.choiceId === 'acceptForSession' ? 'session' : 'turn',
          });
        } else {
          const allowed = new Set(['accept', 'acceptForSession', 'decline', 'cancel']);
          if (!allowed.has(resolution.choiceId)) throw new Error('Unsupported Codex approval choice');
          client.respond(request.id, { decision: resolution.choiceId });
        }
        pendingApprovals.delete(approvalKey(approvalRef));
        return { outcome: 'accepted', resolution };
      } catch (error) {
        if (error instanceof CodexTransportError) {
          return { outcome: 'unknown', error: new RuntimeOperationError('unknown_outcome', error.message, error) };
        }
        return { outcome: 'rejected', error: new RuntimeOperationError('rejected', error instanceof Error ? error.message : 'Codex approval failed', error) };
      }
    },

    async materializeArtifact(handle) {
      assertRuntimeHandle(handle, CODEX_RUNTIME_ID);
      if (handle.opaque.kind === 'managed-file') return materializeCodexManagedArtifact(handle);
      if (handle.opaque.kind !== 'image-generation') throw new RuntimeOperationError('unsupported', 'Unsupported Codex Artifact handle');
      const result = await readThread(handle.opaque.threadId, true);
      const turn = threadTurns(result).find((candidate) => string(candidate.id) === handle.opaque.turnId);
      const item = turnItems(turn || {}).find((candidate) => string(candidate.id) === handle.opaque.itemId);
      const encoded = string(item?.result);
      if (!encoded) throw new Error('Codex image result is unavailable');
      return { bytes: extractImageBytes(encoded), mimeType: 'image/png' };
    },

    async releaseArtifact(handle) {
      if (handle.opaque.kind === 'managed-file') await releaseCodexManagedArtifact(handle);
    },

    createArtifactHandle({ sourceUri, conversationRef, mimeType }) {
      assertRuntimeHandle(conversationRef, CODEX_RUNTIME_ID);
      return runtimeHandle(CODEX_RUNTIME_ID, { kind: 'source', sourceUri, ...(mimeType ? { mimeType } : {}) });
    },

    async readUsageSummary() {
      const result = record(await client.request('account/usage/read', null, 15_000));
      const lifetimeTokens = number(record(result.summary).lifetimeTokens);
      return {
        totalCost: 0,
        totalInput: lifetimeTokens,
        totalOutput: 0,
        totalCacheRead: 0,
        updatedAt: Date.now(),
        source: 'codex-app-server-account-usage',
        period: 'all-time',
        additive: false,
      };
    },

    async readProviderQuotas() {
      const result = record(await client.request('account/rateLimits/read', null, 15_000));
      const byId = record(result.rateLimitsByLimitId);
      const snapshots: Array<[string, unknown]> = Object.keys(byId).length
        ? Object.entries(byId)
        : [['codex', result.rateLimits]];
      const providers: RuntimeProviderQuota[] = snapshots.flatMap(([id, raw]) => {
        const snapshot = record(raw);
        const windows = ['primary', 'secondary'].flatMap((key) => {
          const window = record(snapshot[key]);
          if (typeof window.usedPercent !== 'number') return [];
          return [{
            label: key === 'primary' ? 'Primary window' : 'Secondary window',
            usedPercent: Math.min(100, Math.max(0, number(window.usedPercent))),
            resetAt: number(window.resetsAt) ? number(window.resetsAt) * 1_000 : null,
          }];
        });
        return [{
          provider: id,
          displayName: string(snapshot.limitName) || id,
          plan: string(snapshot.planType) || accountPlan,
          windows,
        }];
      });
      return { available: providers.length > 0, providers };
    },

    async restart() {
      await client.restart();
      await refreshAccount().catch(() => undefined);
      return { output: 'Codex App Server restarted' };
    },

    getStatus: projectedStatus,

    subscribeEvents(listener) {
      runtimeEvents.on('event', listener);
      return () => runtimeEvents.off('event', listener);
    },

    subscribeStatus(listener) {
      runtimeEvents.on('status', listener);
      listener(projectedStatus());
      void client.connect().then(refreshAccount).catch(() => {
        runtimeEvents.emit('status', projectedStatus());
      });
      return () => runtimeEvents.off('status', listener);
    },

    close() {
      if (closed) return;
      closed = true;
      unsubscribeNotification();
      unsubscribeRequest();
      unsubscribeNativeStatus();
      client.close();
      runtimeEvents.removeAllListeners();
    },
  };

  return runtime;
}
