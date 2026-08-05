import { createHash } from 'node:crypto';
import {
  type AgentRuntime,
  type AgentProfile,
  type AgentProfileRef,
  type ApprovalChoice,
  type RuntimeCapabilities,
  type RuntimeEvent,
  type RuntimeHandle,
  RuntimeOperationError,
  type RuntimeProviderQuota,
  type RuntimeStatus,
  type ConversationHandle,
  type DispatchResult,
  assertRuntimeHandle,
  runtimeHandle,
} from '../../contract.js';
import { openClawConfig } from './config.js';
import {
  GatewayDispatchError,
  closeGatewayRpc,
  gatewayDispatchCall,
  gatewayRpcCall,
  gatewaySupports,
  getGatewayRuntimeStatus,
  subscribeGatewayEvents,
  subscribeGatewayStatus,
  type GatewayEvent,
  type GatewayRuntimeStatus,
} from './gateway-rpc.js';
import { getCanvasSessionResetPolicy, sessionWillResetBeforeSend } from './session-policy.js';
import { materializeOpenClawArtifact } from './artifacts.js';
import { extractOpenClawTurn, type OpenClawMessage } from './transcript.js';
import { restartOpenClawGateway } from './restart.js';

const SESSION_LIST_LIMIT = 1_000;
const OPENCLAW_RUNTIME_ID = 'openclaw';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function conversationHandle(sessionKey: string, sessionId?: string): ConversationHandle {
  return runtimeHandle(OPENCLAW_RUNTIME_ID, {
    sessionKey,
    ...(sessionId ? { sessionId } : {}),
  });
}

function turnHandle(runId: string, sessionKey?: string): RuntimeHandle {
  return runtimeHandle(OPENCLAW_RUNTIME_ID, {
    runId,
    ...(sessionKey ? { sessionKey } : {}),
  });
}

function approvalHandle(id: string, kind: 'exec' | 'plugin'): RuntimeHandle {
  return runtimeHandle(OPENCLAW_RUNTIME_ID, { approvalId: id, approvalKind: kind });
}

function gatewayRuntimeCapabilities(): RuntimeCapabilities {
  return {
    conversation: {
      resume: gatewaySupports('sessions.list'),
      readHistory: gatewaySupports('sessions.get'),
      nativeFork: false,
    },
    input: {
      text: gatewaySupports('chat.send'),
      images: gatewaySupports('chat.send'),
      audio: gatewaySupports('chat.send'),
      arbitraryFiles: gatewaySupports('chat.send'),
    },
    output: {
      textStreaming: true,
      imageGeneration: 'unknown',
      artifacts: gatewaySupports('artifacts.list') && gatewaySupports('artifacts.download'),
    },
    execution: {
      interrupt: gatewaySupports('chat.abort'),
      steer: false,
      interactiveApprovals: gatewaySupports('exec.approval.resolve') || gatewaySupports('plugin.approval.resolve'),
    },
    reliability: {
      idempotentDispatch: true,
      inspectAfterUnknownOutcome: false,
    },
    usage: {
      turnTokens: true,
      contextWindow: gatewaySupports('sessions.describe') || gatewaySupports('sessions.list'),
      accountUsage: gatewaySupports('usage.cost'),
      accountQuota: gatewaySupports('usage.status'),
    },
  };
}

function projectStatus(status: GatewayRuntimeStatus): RuntimeStatus {
  return {
    runtimeId: OPENCLAW_RUNTIME_ID,
    state: status.state,
    ...(status.error ? { error: status.error } : {}),
    ...(status.serverVersion ? { version: status.serverVersion } : {}),
    ...(status.maxPayload ? { maxPayload: status.maxPayload } : {}),
    restartSupported: status.gatewayRestartSupported,
    capabilities: gatewayRuntimeCapabilities(),
    diagnostics: { advertisedMethods: status.methods },
  };
}

function eventText(payload: UnknownRecord): string | null {
  const message = payload.message;
  if (typeof message === 'string') return message;
  const content = record(message).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  return content.map((block) => typeof block === 'string' ? block : string(record(block).text)).join('');
}

function eventRefs(payload: UnknownRecord): Pick<RuntimeEvent, 'conversationRef' | 'turnRef'> {
  const sessionKey = string(payload.sessionKey || payload.session_key);
  const runId = string(payload.runId || payload.run_id);
  return {
    ...(sessionKey ? { conversationRef: conversationHandle(sessionKey) } : {}),
    ...(runId ? { turnRef: turnHandle(runId, sessionKey) } : {}),
  };
}

type OpenClawApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

function approvalChoices(value: unknown): ApprovalChoice[] {
  const decisions = Array.isArray(value) ? value : [];
  const filtered = decisions.filter((item): item is OpenClawApprovalDecision =>
    item === 'allow-once' || item === 'allow-always' || item === 'deny');
  const allowed = filtered.length ? filtered : ['allow-once', 'allow-always', 'deny'];
  return allowed.map((decision) => ({
    id: decision,
    intent: decision === 'deny' ? 'deny' : 'grant',
    scope: decision === 'allow-always' ? 'persistent' : 'item',
    label: decision === 'allow-once'
      ? 'Allow once'
      : decision === 'allow-always'
        ? 'Always allow'
        : 'Deny',
    requiresConfirmation: decision === 'allow-always',
  }));
}

function sanitizeApprovalDescription(value: string): string {
  return value
    .slice(0, 4_000)
    .replace(/(authorization\s*:\s*bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[REDACTED]@');
}

export function projectOpenClawEvent(event: GatewayEvent): RuntimeEvent | null {
  const payload = record(event.payload);
  const createdAt = Date.now();
  const sourceEventId = event.seq === undefined
    ? createHash('sha256')
      .update(JSON.stringify({ event: event.event, payload: event.payload ?? null }))
      .digest('hex')
    : `openclaw:${event.event}:${event.seq}`;
  const base = {
    runtimeId: OPENCLAW_RUNTIME_ID,
    eventId: sourceEventId,
    ...(event.seq === undefined ? {} : { sequence: event.seq }),
    createdAt,
  };
  if (event.event === 'chat') {
    const state = string(payload.state);
    const refs = eventRefs(payload);
    const text = eventText(payload);
    if (state === 'delta' && text !== null) return { ...base, ...refs, type: 'output.text.delta', text };
    if (state === 'final') return { ...base, ...refs, type: 'turn.completed', ...(text === null ? {} : { text }) };
    const failure = string(payload.errorMessage || payload.error || payload.stopReason) || 'OpenClaw run failed';
    if (state === 'error') return { ...base, ...refs, type: 'turn.failed', error: failure };
    if (state === 'aborted') return { ...base, ...refs, type: 'turn.interrupted', error: failure };
    return null;
  }

  const approvalMatch = event.event.match(/^(exec|plugin)\.approval\.(requested|resolved)$/);
  if (approvalMatch) {
    const kind = approvalMatch[1] as 'exec' | 'plugin';
    const phase = approvalMatch[2];
    const request = record(payload.request);
    const id = string(payload.id);
    if (!id) return null;
    const sessionKey = string(request.sessionKey || payload.sessionKey);
    const runId = string(request.runId || payload.runId);
    const refs = {
      ...(sessionKey ? { conversationRef: conversationHandle(sessionKey) } : {}),
      ...(runId ? { turnRef: turnHandle(runId, sessionKey) } : {}),
    };
    const stableBase = {
      ...base,
      ...refs,
      eventId: `openclaw:approval:${kind}:${id}:${phase}`,
      approvalRef: approvalHandle(id, kind),
    };
    if (phase === 'resolved') {
      const decision = string(payload.decision);
      if (decision !== 'allow-once' && decision !== 'allow-always' && decision !== 'deny') return null;
      return {
        ...stableBase,
        type: 'approval.resolved',
        resolution: { choiceId: decision },
        ...(string(payload.resolvedBy) ? { resolvedBy: string(payload.resolvedBy) } : {}),
      };
    }
    const isPlugin = kind === 'plugin';
    const title = isPlugin
      ? string(request.title) || 'Plugin action requires approval'
      : 'Command execution requires approval';
    const rawDescription = isPlugin
      ? string(request.description)
      : string(request.commandPreview || request.warningText);
    const description = rawDescription ? sanitizeApprovalDescription(rawDescription) : '';
    const severity = string(request.severity);
    const risk = severity === 'critical' ? 'high' : severity === 'warning' ? 'medium' : 'low';
    return {
      ...stableBase,
      type: 'approval.required',
      approval: {
        category: isPlugin ? 'plugin' : 'command',
        title,
        ...(description ? { description } : {}),
        risk,
        permissions: [{
          id: isPlugin ? 'run-plugin-action' : 'execute-command',
          label: isPlugin ? 'Run this plugin action' : 'Execute this command',
          ...(description ? { description } : {}),
          risk,
        }],
        choices: approvalChoices(request.allowedDecisions),
        ...(number(payload.expiresAtMs) ? { expiresAt: number(payload.expiresAtMs) } : {}),
      },
    };
  }
  return null;
}

function providerQuotas(status: unknown): RuntimeProviderQuota[] {
  const providers = record(status).providers;
  if (!Array.isArray(providers)) return [];
  return providers.flatMap((value) => {
    const provider = record(value);
    const providerId = string(provider.provider);
    if (!providerId) return [];
    const windows = Array.isArray(provider.windows) ? provider.windows.flatMap((raw) => {
      const window = record(raw);
      if (!string(window.label) || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) return [];
      return [{
        label: string(window.label),
        usedPercent: Math.min(100, Math.max(0, window.usedPercent)),
        resetAt: typeof window.resetAt === 'number' && Number.isFinite(window.resetAt) ? window.resetAt : null,
      }];
    }) : [];
    return [{
      provider: providerId,
      displayName: string(provider.displayName) || providerId,
      plan: string(provider.plan) || null,
      windows,
    }];
  });
}

function timestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function terminalSession(session: UnknownRecord): boolean {
  const status = string(session.status).toLowerCase();
  if (['done', 'completed', 'error', 'failed', 'aborted'].includes(status)) return true;
  return session.agentState === 'idle' && !session.busy && !session.processing;
}

export const openClawAgentRuntime: AgentRuntime = {
  id: OPENCLAW_RUNTIME_ID,

  async describe() {
    const status = getGatewayRuntimeStatus();
    return {
      id: OPENCLAW_RUNTIME_ID,
      displayName: 'OpenClaw',
      ...(status.serverVersion ? { version: status.serverVersion } : {}),
    };
  },

  async listAgentProfiles() {
    const response = await gatewayRpcCall('agents.list', {}, 15_000) as {
      defaultId?: string;
      agents?: Array<{ id?: string; name?: string; identity?: { name?: string; emoji?: string }; [key: string]: unknown }>;
    };
    const agents = Array.isArray(response.agents) ? response.agents : [];
    const profiles: AgentProfile[] = agents.flatMap((agent) => {
      const id = string(agent.id).trim();
      if (!id) return [];
      return [{
        runtimeId: OPENCLAW_RUNTIME_ID,
        profileId: id,
        displayName: agent.identity?.name || agent.name || id,
        runtimeProfileRef: runtimeHandle(OPENCLAW_RUNTIME_ID, { agentId: id }),
        metadata: { openClawAgent: agent },
      }];
    });
    const defaultProfileId = string(response.defaultId).trim();
    return { ...(defaultProfileId ? { defaultProfileId } : {}), profiles };
  },

  async getCapabilities(profile: AgentProfileRef) {
    if (profile.runtimeId !== OPENCLAW_RUNTIME_ID) throw new RuntimeOperationError('validation', 'Profile belongs to another Runtime');
    return gatewayRuntimeCapabilities();
  },

  async inspectConversation(handle: ConversationHandle) {
    assertRuntimeHandle(handle, OPENCLAW_RUNTIME_ID);
    const sessionKey = handle.opaque.sessionKey;
    if (!sessionKey) throw new RuntimeOperationError('validation', 'OpenClaw conversation is missing sessionKey');
    let session: UnknownRecord | undefined;
    if (gatewaySupports('sessions.describe')) {
      const response = await gatewayRpcCall('sessions.describe', { key: sessionKey }, 15_000) as {
        session?: UnknownRecord | null;
      };
      session = response.session || undefined;
    } else {
      const response = await gatewayRpcCall('sessions.list', {
        search: sessionKey,
        limit: SESSION_LIST_LIMIT,
      }, 15_000) as { sessions?: UnknownRecord[] };
      session = response.sessions?.find((candidate) => (candidate.sessionKey || candidate.key) === sessionKey);
    }
    const sessionId = session?.sessionId || session?.id;
    const freshContext = session?.totalTokensFresh === true
      && number(session.totalTokens) >= 0
      && number(session.contextTokens) > 0;
    return {
      exists: Boolean(session),
      conversationRef: conversationHandle(sessionKey, string(sessionId) || undefined),
      ...(string(sessionId) ? { instanceId: string(sessionId) } : {}),
      ...(typeof session?.startedAt === 'number' ? { startedAt: session.startedAt } : {}),
      ...(freshContext ? {
        context: {
          usedTokens: number(session?.totalTokens),
          contextLimit: number(session?.contextTokens),
          ...(string(session?.model) ? { model: string(session?.model) } : {}),
          ...(string(session?.modelProvider || session?.provider)
            ? { provider: string(session?.modelProvider || session?.provider) }
            : {}),
          ...(typeof session?.compactionCount === 'number' ? { compactionCount: session.compactionCount } : {}),
        },
      } : {}),
    };
  },

  async conversationWillExpireBeforeNextTurn(handle, input) {
    assertRuntimeHandle(handle, OPENCLAW_RUNTIME_ID);
    const reset = await getCanvasSessionResetPolicy();
    return !reset.available || !reset.policy || sessionWillResetBeforeSend({
      policy: reset.policy,
      sessionStartedAt: input.conversationStartedAt,
      lastInteractionAt: input.lastInteractionAt,
      timeZone: openClawConfig.gatewayTimezone,
    });
  },

  createConversationHandle({ profile, localConversationId }) {
    if (profile.runtimeId !== OPENCLAW_RUNTIME_ID) {
      throw new RuntimeOperationError('validation', 'OpenClaw received a foreign Agent profile');
    }
    return conversationHandle(`agent:${profile.profileId}:canvas:${localConversationId}`);
  },

  async dispatchTurn(input): Promise<DispatchResult> {
    assertRuntimeHandle(input.conversationRef, OPENCLAW_RUNTIME_ID);
    try {
      const raw = await gatewayDispatchCall('chat.send', {
        sessionKey: input.conversationRef.opaque.sessionKey,
        message: input.message,
        ...(input.attachments.length ? { attachments: input.attachments } : {}),
        deliver: false,
        idempotencyKey: input.idempotencyKey,
      }, input.timeoutMs || 30_000) as { runId?: unknown };
      const runId = string(raw.runId);
      return { outcome: 'accepted', turnRef: runId ? turnHandle(runId, input.conversationRef.opaque.sessionKey) : null };
    } catch (error) {
      if (error instanceof GatewayDispatchError) {
        if (error.kind === 'rejected') {
          return { outcome: 'rejected', error: new RuntimeOperationError('rejected', error.message, error) };
        }
        if (error.kind === 'outcome_unknown') {
          return { outcome: 'unknown', error: new RuntimeOperationError('unknown_outcome', error.message, error), recoveryRef: input.conversationRef };
        }
        throw new RuntimeOperationError('unavailable', error.message, error);
      }
      throw error;
    }
  },

  async reconcileDispatch() {
    return {
      outcome: 'unknown',
      error: new RuntimeOperationError(
        'unsupported',
        'OpenClaw relies on idempotent dispatch instead of outcome inspection',
      ),
    };
  },

  async readTurn(input) {
    assertRuntimeHandle(input.conversationRef, OPENCLAW_RUNTIME_ID);
    if (input.turnRef) assertRuntimeHandle(input.turnRef, OPENCLAW_RUNTIME_ID);
    const sessionKey = input.conversationRef.opaque.sessionKey;
    const response = await gatewayRpcCall('sessions.get', {
      key: sessionKey,
      limit: 500,
      includeTools: true,
    }, 15_000) as { messages?: OpenClawMessage[]; id?: string; sessionId?: string };
    const extracted = extractOpenClawTurn(Array.isArray(response.messages) ? response.messages : [], {
      userInput: input.userInput,
      createdAt: input.createdAt,
      ...(input.turnRef?.opaque.runId ? { runId: input.turnRef.opaque.runId } : {}),
    });
    const warnings: string[] = [];
    const nativeArtifacts = [] as typeof extracted.artifacts;
    let complete = true;
    if (!gatewaySupports('artifacts.list') || !gatewaySupports('artifacts.download')) {
      complete = false;
      warnings.push('OpenClaw Gateway does not advertise artifacts.list/download; Artifact sync requires a Gateway upgrade.');
    } else {
      const query = input.turnRef?.opaque.runId
        ? { runId: input.turnRef.opaque.runId, agentId: input.profile.profileId }
        : { sessionKey, agentId: input.profile.profileId };
      try {
        const listed = await gatewayRpcCall('artifacts.list', query, 30_000) as {
          artifacts?: Array<{ id?: string; title?: string; mimeType?: string; sizeBytes?: number }>;
        };
        for (const artifact of listed.artifacts || []) {
          if (!artifact.id) continue;
          const sourceKey = `openclaw-artifact:${input.profile.profileId}:${artifact.id}`;
          nativeArtifacts.push({
            name: artifact.title || artifact.id,
            uri: sourceKey,
            sourceUri: sourceKey,
            ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
            ...(typeof artifact.sizeBytes === 'number' ? { sizeBytes: artifact.sizeBytes } : {}),
            runtimeArtifactRef: runtimeHandle(OPENCLAW_RUNTIME_ID, {
              kind: 'native',
              artifactId: artifact.id,
              agentId: input.profile.profileId,
              sessionKey,
              ...(input.turnRef?.opaque.runId ? { runId: input.turnRef.opaque.runId } : {}),
              ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
            }),
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const scopedRunMissing = Boolean(input.turnRef?.opaque.runId)
          && message.toLowerCase().includes('no session found for artifact query');
        if (!scopedRunMissing) {
          complete = false;
          warnings.push(`OpenClaw Artifact listing failed: ${message}`);
        }
      }
    }
    const fallback = extracted.artifacts
      .filter((artifact) => !nativeArtifacts.some((candidate) =>
        candidate.name === artifact.name
        && (!candidate.mimeType || !artifact.mimeType || candidate.mimeType === artifact.mimeType)
        && (candidate.sizeBytes === undefined
          || artifact.sizeBytes === undefined
          || candidate.sizeBytes === artifact.sizeBytes)))
      .map((artifact) => ({
        ...artifact,
        runtimeArtifactRef: runtimeHandle(OPENCLAW_RUNTIME_ID, {
          kind: 'source',
          uri: artifact.sourceUri || artifact.uri,
          agentId: input.profile.profileId,
          sessionKey,
          ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
        }),
      }));
    return {
      agentOutput: extracted.agentOutput,
      artifacts: [...nativeArtifacts, ...fallback],
      matchedTurn: extracted.matchedTurn,
      ...(response.sessionId || response.id ? { instanceId: response.sessionId || response.id } : {}),
      artifactDiscoveryComplete: complete,
      artifactWarnings: warnings,
    };
  },

  async inspectTurn(input) {
    assertRuntimeHandle(input.conversationRef, OPENCLAW_RUNTIME_ID);
    const sessionKey = input.conversationRef.opaque.sessionKey;
    const response = await gatewayRpcCall('sessions.list', {
      activeMinutes: 7 * 24 * 60,
      limit: SESSION_LIST_LIMIT,
    }) as { sessions?: UnknownRecord[] };
    const session = (response.sessions || []).find((candidate) =>
      string(candidate.sessionKey || candidate.key) === sessionKey);
    if (!session) return { found: false, terminal: false, reflectsTurn: false };
    const terminalAt = timestamp(session.endedAt) ?? timestamp(session.updatedAt);
    const startedAt = timestamp(session.startedAt);
    const reflectsTurn = terminalAt !== undefined && terminalAt >= input.createdAt + 250
      || startedAt !== undefined && startedAt >= input.createdAt - 250;
    const status = string(session.status).toLowerCase();
    return {
      found: true,
      terminal: terminalSession(session),
      reflectsTurn,
      ...(terminalAt === undefined ? {} : { terminalAt }),
      ...(['error', 'failed', 'aborted'].includes(status)
        ? { failure: string(session.error) || `OpenClaw Session ${status}` }
        : {}),
      ...(string(session.sessionId || session.id) ? { instanceId: string(session.sessionId || session.id) } : {}),
    };
  },

  async resolveApproval({ approvalRef, resolution }) {
    assertRuntimeHandle(approvalRef, OPENCLAW_RUNTIME_ID);
    const id = approvalRef.opaque.approvalId;
    const kind = approvalRef.opaque.approvalKind;
    if (!id || (kind !== 'exec' && kind !== 'plugin')) throw new RuntimeOperationError('validation', 'Invalid OpenClaw approval handle');
    const decision = resolution.choiceId;
    if (decision !== 'allow-once' && decision !== 'allow-always' && decision !== 'deny') {
      return {
        outcome: 'rejected',
        error: new RuntimeOperationError('validation', 'Unsupported OpenClaw approval choice'),
      };
    }
    try {
      await gatewayRpcCall(`${kind}.approval.resolve`, { id, decision }, 15_000);
      return { outcome: 'accepted', resolution };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Approval resolution failed';
      const operationError = new RuntimeOperationError(
        /timeout|timed out|closed|disconnect/i.test(message)
          ? 'unknown_outcome'
          : /scope|permission|unauthorized/i.test(message)
            ? 'unauthorized'
            : 'conflict',
        message,
        error,
      );
      return operationError.kind === 'unknown_outcome'
        ? { outcome: 'unknown', error: operationError }
        : { outcome: 'rejected', error: operationError };
    }
  },

  async materializeArtifact(handle) {
    return materializeOpenClawArtifact(handle);
  },

  createArtifactHandle({ sourceUri, profile, conversationRef, mimeType }) {
    assertRuntimeHandle(conversationRef, OPENCLAW_RUNTIME_ID);
    return runtimeHandle(OPENCLAW_RUNTIME_ID, {
      kind: 'source',
      uri: sourceUri,
      agentId: profile.profileId,
      sessionKey: conversationRef.opaque.sessionKey,
      ...(mimeType ? { mimeType } : {}),
    });
  },

  async readUsageSummary() {
    const cost = record(await gatewayRpcCall('usage.cost', { agentScope: 'all', range: 'all', mode: 'gateway' }, 60_000));
    const totals = record(cost.totals);
    return {
      totalCost: number(totals.totalCost ?? totals.cost),
      totalInput: number(totals.input),
      totalOutput: number(totals.output),
      totalCacheRead: number(totals.cacheRead),
      updatedAt: number(cost.updatedAt) || Date.now(),
      source: 'openclaw-gateway',
      currency: 'USD',
      period: 'all-time',
      additive: true,
    };
  },

  async readProviderQuotas() {
    try {
      return { available: true, providers: providerQuotas(await gatewayRpcCall('usage.status', {}, 15_000)) };
    } catch {
      return { available: false, providers: [] };
    }
  },

  restart() {
    return restartOpenClawGateway();
  },

  getStatus() {
    return projectStatus(getGatewayRuntimeStatus());
  },

  subscribeEvents(listener) {
    return subscribeGatewayEvents((event) => {
      const projected = projectOpenClawEvent(event);
      if (projected) listener(projected);
    });
  },

  subscribeStatus(listener) {
    return subscribeGatewayStatus((status) => listener(projectStatus(status)));
  },

  close() {
    closeGatewayRpc();
  },
};

export const openClawHandles = { conversationHandle, turnHandle, approvalHandle };
