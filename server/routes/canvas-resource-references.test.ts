import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));
let tempRoot = '';

const capabilities = {
  conversation: { resume: true, readHistory: true, nativeFork: false },
  input: { text: true, images: true, audio: true, arbitraryFiles: true },
  output: { textStreaming: true, imageGeneration: 'supported' as const, artifacts: true },
  execution: { interrupt: true, steer: false, interactiveApprovals: false },
  reliability: { idempotentDispatch: true, inspectAfterUnknownOutcome: true },
  usage: { turnTokens: true, contextWindow: true, accountUsage: false, accountQuota: false },
};

async function setup() {
  vi.resetModules();
  vi.doMock('../lib/config.js', () => ({
    config: {
      auth: false,
      canvasDatabasePath: path.join(tempRoot, 'canvas.sqlite'),
      canvasArtifactsPath: path.join(tempRoot, 'artifacts'),
      gatewayTimezone: 'UTC',
    },
    SESSION_COOKIE_NAME: 'convosketchpad_session_test',
  }));
  vi.doMock('../lib/canvas-auth.js', () => ({
    getCanvasIdentity: () => ({ userId: 'owner-a', name: 'Owner A' }),
  }));
  vi.doMock('../middleware/rate-limit.js', () => ({
    rateLimitGeneral: async (_c: unknown, next: () => Promise<void>) => next(),
  }));
  const db = await import('../lib/canvas/persistence/canvas-store.js');
  const { testConversationHandleFactory } = await import('../lib/fixtures/test-conversation-handle.js');
  const store = db.getCanvasStore(testConversationHandleFactory);
  const route = await import('./canvas.js');
  const runtime = {
    id: 'openclaw',
    getStatus: () => ({ runtimeId: 'openclaw', state: 'connected' as const }),
    describe: vi.fn(async () => ({ displayName: 'OpenClaw' })),
    listAgentProfiles: vi.fn(async () => ({
      defaultProfileId: 'main',
      profiles: [{ runtimeId: 'openclaw', profileId: 'main', displayName: 'Main' }],
    })),
    getCapabilities: vi.fn(async () => capabilities),
    inspectConversation: vi.fn(async () => null),
    prepareConversation: vi.fn(async () => ({ outcome: 'continued' as const })),
  };
  const app = new Hono();
  app.route('/', route.createCanvasRoutes({
    store,
    runtimes: { get: () => runtime, list: () => [runtime] } as never,
    dispatchSend: mocks.dispatch,
  }));
  return { app, store };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-resource-route-'));
  mocks.dispatch.mockReset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('Canvas resource reference routes', () => {
  it('lists only parent-chain resources and accepts an inline current attachment', async () => {
    const { app, store } = await setup();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Canvas', { runtimeId: 'openclaw', profileId: 'main' });
    const branch = store.createRootBranch('owner-a', canvas.id);
    const attachmentId = 'a'.repeat(40);
    const attachment = store.recordCanvasAttachment('owner-a', canvas.id, {
      id: attachmentId, contentHash: 'b'.repeat(64), name: 'brief.pdf',
      mimeType: 'application/pdf', sizeBytes: 10,
      uri: `/api/canvas/attachments/${canvas.id}/${attachmentId}`,
      storage: 'canvas', available: true,
    });
    mocks.dispatch.mockImplementation(async (reservationId: string) =>
      store.acknowledgeSend('owner-a', reservationId, 'turn-1'));
    const response = await app.request(`/api/canvas/branches/${branch.id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedHeadInteractionId: null,
        agentRef: canvas.agentRef,
        attachmentIds: [attachmentId],
        inputDocument: {
          version: 1,
          segments: [{ type: 'text', text: 'read ' }, { type: 'resource', key: 'brief' }],
          references: [{ key: 'brief', origin: 'current_turn_attachment', attachmentId }],
        },
      }),
    });
    const payload = await response.json() as { interaction: { id: string; inputDocument: unknown } };
    expect(response.status).toBe(201);
    expect(payload.interaction.inputDocument).toMatchObject({ version: 1 });

    const nextBranch = store.createRootBranch('owner-a', canvas.id);
    const rootCatalog = await (await app.request(
      `/api/canvas/branches/${nextBranch.id}/resources?runtimeId=openclaw&profileId=main`,
    )).json() as { items: unknown[] };
    expect(rootCatalog.items).toEqual([]);

    const catalog = await (await app.request(
      `/api/canvas/branches/${branch.id}/resources?runtimeId=openclaw&profileId=main`,
    )).json() as { items: Array<{ name: string; reference: { sourceInteractionId: string } }> };
    expect(catalog.items).toEqual([
      expect.objectContaining({
        name: attachment.name,
        reference: expect.objectContaining({ sourceInteractionId: payload.interaction.id }),
      }),
    ]);

    const upstreamResponse = await app.request(`/api/canvas/branches/${branch.id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedHeadInteractionId: payload.interaction.id,
        agentRef: canvas.agentRef,
        attachmentIds: [],
        inputDocument: {
          version: 1,
          segments: [
            { type: 'text', text: 'reuse ' },
            { type: 'resource', key: 'upstream-brief' },
          ],
          references: [{
            key: 'upstream-brief',
            origin: 'upstream',
            kind: 'canvas_attachment',
            sourceInteractionId: payload.interaction.id,
            resourceId: attachmentId,
          }],
        },
      }),
    });
    const upstreamPayload = await upstreamResponse.json() as {
      interaction: { resourceReferences: Array<{ origin: string; sourceInteractionId: string }> };
    };
    expect(upstreamResponse.status).toBe(201);
    expect(upstreamPayload.interaction.resourceReferences).toEqual([
      expect.objectContaining({
        origin: 'upstream',
        sourceInteractionId: payload.interaction.id,
      }),
    ]);
  });

  it('rejects a forged sibling reference until its completed interaction is connected', async () => {
    const { app, store } = await setup();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Canvas', { runtimeId: 'openclaw', profileId: 'main' });
    const sourceBranch = store.createRootBranch('owner-a', canvas.id);
    const attachmentId = 'c'.repeat(40);
    const attachment = store.recordCanvasAttachment('owner-a', canvas.id, {
      id: attachmentId, name: 'sibling.pdf', mimeType: 'application/pdf', sizeBytes: 10,
      uri: `/api/canvas/attachments/${canvas.id}/${attachmentId}`, storage: 'canvas', available: true,
    });
    const reservation = store.prepareSend('owner-a', {
      branchId: sourceBranch.id, userInput: 'source', attachments: [attachment],
    });
    const sibling = store.acknowledgeSend('owner-a', reservation.id, 'turn-source');
    const targetBranch = store.createRootBranch('owner-a', canvas.id);
    const response = await app.request(`/api/canvas/branches/${targetBranch.id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedHeadInteractionId: null,
        agentRef: canvas.agentRef,
        attachmentIds: [],
        inputDocument: {
          version: 1,
          segments: [{ type: 'resource', key: 'forged' }],
          references: [{
            key: 'forged', origin: 'upstream', kind: 'canvas_attachment',
            sourceInteractionId: sibling.id, resourceId: attachmentId,
          }],
        },
      }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'resource_reference_unavailable' });
    expect(mocks.dispatch).not.toHaveBeenCalled();

    store.applyReconciledInteraction(sibling.id, {
      status: 'completed', agentOutput: 'source complete', artifacts: [],
      artifactSyncState: 'synced', artifactObservationPending: false,
      error: null, reconciliation: {},
    });
    const redundant = await app.request(
      `/api/canvas/branches/${sourceBranch.id}/merge-sources/${sibling.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedHeadInteractionId: sibling.id }),
      },
    );
    expect(redundant.status).toBe(409);
    expect(await redundant.json()).toEqual({ error: 'redundant_merge_source' });

    const connect = await app.request(
      `/api/canvas/branches/${targetBranch.id}/merge-sources/${sibling.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedHeadInteractionId: null }),
      },
    );
    expect(connect.status).toBe(201);
    expect(await connect.json()).toMatchObject({
      created: true,
      mergeSource: { sourceInteractionId: sibling.id, targetBranchId: targetBranch.id },
    });
    const duplicate = await app.request(
      `/api/canvas/branches/${targetBranch.id}/merge-sources/${sibling.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedHeadInteractionId: null }),
      },
    );
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ created: false });

    const catalog = await (await app.request(
      `/api/canvas/branches/${targetBranch.id}/resources?runtimeId=openclaw&profileId=main`,
    )).json() as { items: Array<{ name: string }> };
    expect(catalog.items).toEqual([expect.objectContaining({ name: 'sibling.pdf' })]);
  });
});
