import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeStatus } from '../../contract.js';
import { createOpenCodeAgentRuntime } from './adapter.js';
import { OpenCodeHttpError, OpenCodeTransportError, type OpenCodeServerClient } from './server-client.js';

type UnknownRecord = Record<string, unknown>;

class FakeClient {
  requests: Array<{ method: string; path: string; body: unknown }> = [];
  eventListeners: Array<(event: UnknownRecord) => void> = [];
  status: RuntimeStatus = { runtimeId: 'opencode', state: 'connected', version: '1.18.16' };
  promptError?: Error;
  messages: UnknownRecord[] = [];

  async connect() {}
  async restart() {}
  close() {}
  getStatus() { return this.status; }
  subscribeEvent(listener: (event: UnknownRecord) => void) { this.eventListeners.push(listener); return () => undefined; }
  subscribeStatus(listener: (status: RuntimeStatus) => void) { listener(this.status); return () => undefined; }

  async request(method: string, requestPath: string, body?: unknown) {
    this.requests.push({ method, path: requestPath, body });
    if (method === 'POST' && requestPath === '/session') return { id: 'ses_1', time: { created: 10 } };
    if (method === 'POST' && requestPath.endsWith('/prompt_async')) {
      if (this.promptError) throw this.promptError;
      return undefined;
    }
    if (method === 'GET' && requestPath === '/provider') {
      return {
        all: [{ id: 'provider-1', models: { 'model-1': { limit: { context: 100_000 } } } }],
        connected: ['provider-1'],
        default: { 'provider-1': 'model-1' },
      };
    }
    if (method === 'GET' && requestPath.includes('/message/')) {
      const id = decodeURIComponent(requestPath.split('/').at(-1) || '');
      const message = this.messages.find((candidate) => (candidate.info as UnknownRecord)?.id === id);
      if (!message) throw new OpenCodeHttpError(404, 'not found');
      return message;
    }
    if (method === 'GET' && requestPath.endsWith('/message')) return this.messages;
    if (method === 'GET' && requestPath.startsWith('/session/')) return { id: 'ses_1', time: { created: 10 } };
    if (method === 'GET' && requestPath.startsWith('/session?')) return [];
    if (method === 'GET' && requestPath === '/permission') return [];
    if (method === 'POST' && requestPath.includes('/permission/')) return true;
    return {};
  }
}

describe('OpenCode Agent Runtime Adapter', () => {
  let workspace = '';
  let temporaryHome = '';
  let client: FakeClient;

  beforeEach(async () => {
    temporaryHome = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-adapter-'));
    vi.spyOn(os, 'homedir').mockReturnValue(temporaryHome);
    workspace = path.join(temporaryHome, '.convosketchpad', 'workspace');
    await fs.mkdir(workspace, { recursive: true });
    client = new FakeClient();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(temporaryHome, { recursive: true, force: true });
  });

  function runtimeAndConversation() {
    const runtime = createOpenCodeAgentRuntime(client as unknown as OpenCodeServerClient);
    const conversationRef = runtime.createConversationHandle({
      profile: { runtimeId: 'opencode', profileId: 'default' }, localConversationId: 'local-1',
    });
    return { runtime, conversationRef };
  }

  it('publishes one Default profile and pass-through input capabilities', async () => {
    const { runtime } = runtimeAndConversation();
    await expect(runtime.listAgentProfiles({ ownerId: 'owner' })).resolves.toMatchObject({
      defaultProfileId: 'default', profiles: [{ displayName: 'OpenCode', profileId: 'default' }],
    });
    await expect(runtime.getCapabilities({ runtimeId: 'opencode', profileId: 'default' })).resolves.toMatchObject({
      input: { text: true, images: true, audio: true, arbitraryFiles: true },
      output: { imageGeneration: 'supported' },
      reliability: { idempotentDispatch: false, inspectAfterUnknownOutcome: true },
    });
    runtime.close();
  });

  it('uses the native default Agent/model and forwards every attachment as FilePart', async () => {
    const { runtime, conversationRef } = runtimeAndConversation();
    const result = await runtime.dispatchTurn({
      profile: { runtimeId: 'opencode', profileId: 'default' }, conversationRef,
      message: 'Inspect these files', idempotencyKey: 'reservation-1',
      attachments: [
        { fileName: 'image.png', mimeType: 'image/png', content: 'aW1hZ2U=' },
        { fileName: 'audio.mp3', mimeType: 'audio/mpeg', content: 'YXVkaW8=' },
        { fileName: 'report.pdf', mimeType: 'application/pdf', content: 'cGRm' },
        { fileName: 'data.bin', mimeType: 'application/octet-stream', content: 'Ymlu' },
      ],
    });
    expect(result).toMatchObject({ outcome: 'accepted', conversationRef: { opaque: { sessionId: 'ses_1' } } });
    const prompt = client.requests.find((request) => request.path.endsWith('/prompt_async'))!;
    expect(prompt.body).not.toHaveProperty('model');
    expect(prompt.body).not.toHaveProperty('agent');
    expect(prompt.body).toMatchObject({ tools: { question: false } });
    expect((prompt.body as { parts: UnknownRecord[] }).parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'file', filename: 'image.png', mime: 'image/png', url: 'data:image/png;base64,aW1hZ2U=' }),
      expect.objectContaining({ type: 'file', filename: 'audio.mp3', mime: 'audio/mpeg' }),
      expect.objectContaining({ type: 'file', filename: 'report.pdf', mime: 'application/pdf' }),
      expect.objectContaining({ type: 'file', filename: 'data.bin', mime: 'application/octet-stream' }),
    ]));
    runtime.close();
  });

  it('returns a sanitized native rejection instead of locally rejecting media', async () => {
    client.promptError = new OpenCodeHttpError(400, 'Model does not support image input; token=secret');
    const { runtime, conversationRef } = runtimeAndConversation();
    const result = await runtime.dispatchTurn({
      profile: { runtimeId: 'opencode', profileId: 'default' }, conversationRef,
      message: 'Use image', attachments: [{ fileName: 'x.png', mimeType: 'image/png', content: 'eA==' }],
      idempotencyKey: 'reservation-rejected',
    });
    expect(result).toMatchObject({ outcome: 'rejected', error: { kind: 'rejected' } });
    if (result.outcome === 'rejected') {
      expect(result.error.message).toContain('does not support image');
      expect(result.error.message).not.toContain('secret');
    }
    runtime.close();
  });

  it('reconciles an uncertain prompt by exact client Message ID', async () => {
    client.promptError = new OpenCodeTransportError('connection closed after write');
    const { runtime, conversationRef } = runtimeAndConversation();
    const dispatched = await runtime.dispatchTurn({
      profile: { runtimeId: 'opencode', profileId: 'default' }, conversationRef,
      message: 'Continue', attachments: [], idempotencyKey: 'reservation-unknown',
    });
    expect(dispatched.outcome).toBe('unknown');
    if (dispatched.outcome !== 'unknown') throw new Error('expected unknown');
    const userMessageId = dispatched.recoveryRef?.opaque.userMessageId || '';
    client.messages = [{ info: { id: userMessageId, sessionID: 'ses_1', role: 'user', time: { created: 20 } }, parts: [] }];
    await expect(runtime.reconcileDispatch({
      profile: { runtimeId: 'opencode', profileId: 'default' }, conversationRef,
      recoveryRef: dispatched.recoveryRef || null, idempotencyKey: 'reservation-unknown', message: 'Continue', createdAt: 20,
    })).resolves.toMatchObject({ outcome: 'accepted', turnRef: { opaque: { sessionId: 'ses_1', userMessageId } } });
    runtime.close();
  });

  it('reads all direct Assistant children and captures a generated FilePart', async () => {
    const { runtime, conversationRef } = runtimeAndConversation();
    const dispatched = await runtime.dispatchTurn({
      profile: { runtimeId: 'opencode', profileId: 'default' }, conversationRef,
      message: 'Generate image', attachments: [], idempotencyKey: 'reservation-read',
    });
    if (dispatched.outcome !== 'accepted' || !dispatched.turnRef) throw new Error('expected accepted');
    const userMessageId = dispatched.turnRef.opaque.userMessageId;
    client.messages = [
      { info: { id: userMessageId, role: 'user' }, parts: [] },
      { info: { id: 'msg_a', role: 'assistant', parentID: userMessageId, finish: 'tool-calls', tokens: { total: 20 }, providerID: 'provider-1', modelID: 'model-1' }, parts: [{ id: 'prt_a', messageID: 'msg_a', type: 'text', text: 'Working' }] },
      { info: { id: 'msg_b', role: 'assistant', parentID: userMessageId, finish: 'stop', time: { completed: 30 }, tokens: { total: 40 }, providerID: 'provider-1', modelID: 'model-1' }, parts: [
        { id: 'prt_b', messageID: 'msg_b', type: 'text', text: 'Done' },
        { id: 'prt_image', messageID: 'msg_b', type: 'file', filename: 'result.png', mime: 'image/png', url: 'data:image/png;base64,aW1hZ2U=' },
      ] },
    ];
    await expect(runtime.readTurn({
      profile: { runtimeId: 'opencode', profileId: 'default' },
      conversationRef: (dispatched as { conversationRef: typeof conversationRef }).conversationRef,
      turnRef: dispatched.turnRef, userInput: 'Generate image', createdAt: 20,
    })).resolves.toMatchObject({
      agentOutput: 'Working\nDone', matchedTurn: true, artifactDiscoveryComplete: true,
      artifacts: [expect.objectContaining({ name: 'result.png', mimeType: 'image/png' })],
    });
    runtime.close();
  });

  it('projects and resolves OpenCode permission choices', async () => {
    const { runtime } = runtimeAndConversation();
    const events: UnknownRecord[] = [];
    runtime.subscribeEvents((event) => events.push(event as unknown as UnknownRecord));
    await client.eventListeners[0]({
      id: 'evt_1', type: 'permission.asked',
      data: { id: 'per_1', sessionID: 'ses_1', permission: 'bash', patterns: ['npm test'], metadata: {}, always: [] },
    });
    const required = events[0] as { approvalRef: Parameters<typeof runtime.resolveApproval>[0]['approvalRef']; approval: { choices: Array<{ id: string }> } };
    expect(required.approval.choices.map((choice) => choice.id)).toEqual(['once', 'always', 'reject']);
    await expect(runtime.resolveApproval({
      approvalRef: required.approvalRef,
      resolution: { choiceId: 'once', grantedPermissionIds: [] },
    })).resolves.toMatchObject({ outcome: 'rejected', error: { kind: 'validation' } });
    await expect(runtime.resolveApproval({ approvalRef: required.approvalRef, resolution: { choiceId: 'once' } }))
      .resolves.toMatchObject({ outcome: 'accepted' });
    expect(client.requests).toContainEqual(expect.objectContaining({ method: 'POST', path: '/permission/per_1/reply', body: { reply: 'once' } }));
    runtime.close();
  });

  it('turns an asynchronous native attachment error into a sanitized Turn failure', async () => {
    const { runtime, conversationRef } = runtimeAndConversation();
    const events: UnknownRecord[] = [];
    runtime.subscribeEvents((event) => events.push(event as unknown as UnknownRecord));
    const sent = await runtime.dispatchTurn({
      profile: { runtimeId: 'opencode', profileId: 'default' }, conversationRef,
      message: 'Use image', attachments: [{ fileName: 'x.png', mimeType: 'image/png', content: 'eA==' }],
      idempotencyKey: 'reservation-async-rejection',
    });
    expect(sent.outcome).toBe('accepted');
    await client.eventListeners[0]({
      id: 'evt_error', type: 'session.error',
      data: { sessionID: 'ses_1', error: { message: 'Model does not support image input\n    at internal (/secret/path)' } },
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'turn.failed', error: 'Model does not support image input',
    }));
    if (sent.outcome !== 'accepted' || !sent.turnRef) throw new Error('expected accepted');
    await expect(runtime.inspectTurn({
      profile: { runtimeId: 'opencode', profileId: 'default' },
      conversationRef: sent.conversationRef || conversationRef,
      turnRef: sent.turnRef,
      userInput: 'Use image',
      createdAt: Date.now(),
    })).resolves.toMatchObject({
      found: true, terminal: true, reflectsTurn: true, failure: 'Model does not support image input',
    });
    runtime.close();
  });
});
