import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RuntimeStatus } from '../../contract.js';
import { createCodexAgentRuntime } from './adapter.js';
import { managedArtifactToken } from './artifacts.js';
import {
  CodexRpcError,
  CodexTransportError,
  type CodexAppServerClient,
  type CodexServerRequest,
} from './app-server-client.js';

class FakeClient {
  requests: Array<{ method: string; params: Record<string, unknown> | null }> = [];
  notifications: Array<(method: string, params: Record<string, unknown>) => void> = [];
  serverRequests: Array<(request: CodexServerRequest) => void> = [];
  statusListeners: Array<(status: RuntimeStatus) => void> = [];
  turns: Array<Record<string, unknown>> = [];
  turnStartError?: Error;
  loggedIn = true;
  status: RuntimeStatus = { runtimeId: 'codex', state: 'connected', version: '0.146.0' };

  async connect() {}
  async restart() {}
  close() {}
  getStatus() { return this.status; }
  subscribeNotification(listener: (method: string, params: Record<string, unknown>) => void) {
    this.notifications.push(listener); return () => undefined;
  }
  subscribeServerRequest(listener: (request: CodexServerRequest) => void) {
    this.serverRequests.push(listener); return () => undefined;
  }
  subscribeStatus(listener: (status: RuntimeStatus) => void) {
    this.statusListeners.push(listener); listener(this.status); return () => undefined;
  }
  respond = vi.fn();
  respondError = vi.fn();

  async request(method: string, params: Record<string, unknown> | null = null) {
    this.requests.push({ method, params });
    if (method === 'account/read') return this.loggedIn
      ? { account: { type: 'chatgpt', planType: 'pro' }, requiresOpenaiAuth: true }
      : { account: null, requiresOpenaiAuth: true };
    if (method === 'thread/start') return { thread: { id: 'thread-1' } };
    if (method === 'thread/resume') return { thread: { id: 'thread-1' } };
    if (method === 'thread/read') return { thread: { id: 'thread-1', status: { type: 'notLoaded' }, turns: this.turns } };
    if (method === 'turn/start') {
      if (this.turnStartError) throw this.turnStartError;
      return { turn: { id: 'turn-1', status: 'inProgress', items: [] } };
    }
    if (method === 'account/usage/read') return { summary: { lifetimeTokens: 12 } };
    if (method === 'account/rateLimits/read') return { rateLimits: { limitId: 'codex', primary: { usedPercent: 5, resetsAt: 10 } } };
    return {};
  }
}

describe('Codex Agent Runtime Adapter', () => {
  let workspace = '';
  let client: FakeClient;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-adapter-'));
    process.env.CODEX_WORKING_DIRECTORY = workspace;
    client = new FakeClient();
  });

  afterEach(async () => {
    delete process.env.CODEX_WORKING_DIRECTORY;
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('starts a stable Default-mode turn with a managed Artifact directory', async () => {
    const runtime = createCodexAgentRuntime(client as unknown as CodexAppServerClient);
    const conversationRef = runtime.createConversationHandle({
      profile: { runtimeId: 'codex', profileId: 'default' },
      localConversationId: 'local-1',
    });
    const result = await runtime.dispatchTurn({
      profile: { runtimeId: 'codex', profileId: 'default' },
      conversationRef,
      message: 'Create a report',
      attachments: [],
      idempotencyKey: 'reservation-1',
    });
    expect(result).toMatchObject({
      outcome: 'accepted',
      conversationRef: { opaque: { threadId: 'thread-1' } },
      turnRef: { opaque: { threadId: 'thread-1', turnId: 'turn-1' } },
    });
    const turnStart = client.requests.find((request) => request.method === 'turn/start')!;
    expect(turnStart.params).not.toHaveProperty('model');
    expect(turnStart.params).not.toHaveProperty('approvalPolicy');
    expect(JSON.stringify(turnStart.params)).toContain('.convosketchpad-artifacts');
    runtime.close();
  });

  it('does not publish an available Agent while the shared Codex account is logged out', async () => {
    client.loggedIn = false;
    const runtime = createCodexAgentRuntime(client as unknown as CodexAppServerClient);
    await expect(runtime.listAgentProfiles({ ownerId: 'owner-a' })).rejects.toThrow('not logged in');
    expect(runtime.getStatus()).toMatchObject({ state: 'disconnected', diagnostics: { authenticated: false } });
    runtime.close();
  });

  it('resumes a notLoaded Thread instead of replaying it', async () => {
    const runtime = createCodexAgentRuntime(client as unknown as CodexAppServerClient);
    await expect(runtime.prepareConversation({
      runtimeId: 'codex', schemaVersion: 1, opaque: { threadId: 'thread-1' },
    }, { conversationStartedAt: null, lastInteractionAt: null })).resolves.toEqual({ outcome: 'continued' });
    runtime.close();
  });

  it('projects App Server token usage into the completion context snapshot', async () => {
    const runtime = createCodexAgentRuntime(client as unknown as CodexAppServerClient);
    await client.notifications[0]('thread/tokenUsage/updated', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      tokenUsage: {
        total: { totalTokens: 425_460 },
        last: { totalTokens: 321 },
        modelContextWindow: 100_000,
      },
    });

    await expect(runtime.inspectConversation({
      runtimeId: 'codex', schemaVersion: 1, opaque: { threadId: 'thread-1' },
    })).resolves.toMatchObject({
      instanceId: 'thread-1',
      context: { usedTokens: 321, contextLimit: 100_000 },
    });
    runtime.close();
  });

  it('preserves Codex message item identity across append-only deltas and completion', async () => {
    const runtime = createCodexAgentRuntime(client as unknown as CodexAppServerClient);
    const events: Array<Record<string, unknown>> = [];
    runtime.subscribeEvents((event) => events.push(event as unknown as Record<string, unknown>));

    await client.notifications[0]('item/agentMessage/delta', {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'message-1', delta: 'partial',
    });
    await client.notifications[0]('item/completed', {
      threadId: 'thread-1', turnId: 'turn-1', item: { id: 'message-1', type: 'agentMessage', text: 'partial output' },
    });

    expect(events).toEqual([
      expect.objectContaining({ type: 'output.text.delta', messageId: 'message-1', text: 'partial' }),
      expect.objectContaining({ type: 'output.message.completed', messageId: 'message-1', text: 'partial output' }),
    ]);
    runtime.close();
  });

  it('removes managed Turn files after an explicit turn/start rejection', async () => {
    client.turnStartError = new CodexRpcError('invalid turn');
    const runtime = createCodexAgentRuntime(client as unknown as CodexAppServerClient);
    const conversationRef = runtime.createConversationHandle({
      profile: { runtimeId: 'codex', profileId: 'default' },
      localConversationId: 'local-rejected',
    });
    const result = await runtime.dispatchTurn({
      profile: { runtimeId: 'codex', profileId: 'default' },
      conversationRef,
      message: 'Create a report',
      attachments: [],
      idempotencyKey: 'reservation-rejected',
    });

    expect(result.outcome).toBe('rejected');
    const managedDirectory = path.join(
      workspace,
      '.convosketchpad-artifacts',
      managedArtifactToken('reservation-rejected'),
    );
    await expect(fs.access(managedDirectory)).rejects.toThrow();
    runtime.close();
  });

  it('reconciles an unknown turn/start outcome from the persisted Thread', async () => {
    client.turnStartError = new CodexTransportError('connection closed after write');
    const runtime = createCodexAgentRuntime(client as unknown as CodexAppServerClient);
    const conversationRef = runtime.createConversationHandle({
      profile: { runtimeId: 'codex', profileId: 'default' },
      localConversationId: 'local-unknown',
    });
    const dispatched = await runtime.dispatchTurn({
      profile: { runtimeId: 'codex', profileId: 'default' },
      conversationRef,
      message: 'Create a report',
      attachments: [],
      idempotencyKey: 'reservation-unknown',
    });
    expect(dispatched.outcome).toBe('unknown');
    if (dispatched.outcome !== 'unknown') throw new Error('Expected unknown dispatch outcome');
    const token = managedArtifactToken('reservation-unknown');
    client.turns = [{
      id: 'turn-recovered',
      status: 'completed',
      items: [{ type: 'userMessage', content: [{ type: 'text', text: token }] }],
    }];

    await expect(runtime.reconcileDispatch({
      profile: { runtimeId: 'codex', profileId: 'default' },
      conversationRef,
      idempotencyKey: 'reservation-unknown',
      recoveryRef: dispatched.recoveryRef,
    })).resolves.toMatchObject({
      outcome: 'accepted',
      conversationRef: { opaque: { threadId: 'thread-1' } },
      turnRef: { opaque: { turnId: 'turn-recovered', deliveryToken: token } },
    });
    runtime.close();
  });

  it('projects and resolves command approvals without persistent amendments', async () => {
    const runtime = createCodexAgentRuntime(client as unknown as CodexAppServerClient);
    const events: Array<Record<string, unknown>> = [];
    runtime.subscribeEvents((event) => events.push(event as unknown as Record<string, unknown>));
    client.serverRequests[0]({
      id: 9,
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', command: 'npm test' },
    });
    const required = events[0] as { approvalRef: Parameters<typeof runtime.resolveApproval>[0]['approvalRef']; approval: { choices: Array<{ id: string }> } };
    expect(required.approval.choices.map((choice) => choice.id)).toEqual(['accept', 'acceptForSession', 'decline', 'cancel']);
    await expect(runtime.resolveApproval({
      approvalRef: required.approvalRef,
      resolution: { choiceId: 'accept' },
    })).resolves.toMatchObject({ outcome: 'accepted' });
    expect(client.respond).toHaveBeenCalledWith(9, { decision: 'accept' });
    runtime.close();
  });
});
