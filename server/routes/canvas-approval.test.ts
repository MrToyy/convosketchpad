import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  resolveApproval: vi.fn(),
}));

let tempRoot = '';
let resetStore: (() => void) | null = null;

async function setup() {
  vi.resetModules();
  vi.doMock('../lib/config.js', () => ({
    config: {
      auth: false,
      canvasDatabasePath: path.join(tempRoot, 'canvas.sqlite'),
      canvasArtifactsPath: path.join(tempRoot, 'artifacts'),
    },
    SESSION_COOKIE_NAME: 'convosketchpad_session_test',
  }));
  vi.doMock('../lib/canvas-auth.js', () => ({
    getCanvasIdentity: () => ({ userId: 'owner-a', name: 'Owner A' }),
  }));
  vi.doMock('../middleware/rate-limit.js', () => ({
    rateLimitGeneral: async (_context: unknown, next: () => Promise<void>) => next(),
  }));
  vi.doMock('../lib/canvas-send-coordinator.js', () => ({ dispatchCanvasSend: vi.fn() }));
  const db = await import('../lib/canvas/persistence/canvas-store.js');
  const { testConversationHandleFactory } = await import('../lib/fixtures/test-conversation-handle.js');
  db.getCanvasStore(testConversationHandleFactory);
  const route = await import('./canvas.js');
  const app = new Hono();
  const runtime = {
    resolveApproval: mocks.resolveApproval,
  };
  app.route('/', route.createCanvasRoutes({
    store: db.getCanvasStore(),
    runtimes: { get: () => runtime, list: () => [] } as never,
  }));
  resetStore = db.resetCanvasStoreForTests;
  return { app, db };
}

function seedApproval(db: typeof import('../lib/canvas/persistence/canvas-store.js')) {
  const store = db.getCanvasStore();
  store.ensureUser('owner-a', 'Owner A');
  const canvas = store.createCanvas('owner-a', 'Canvas', { runtimeId: 'openclaw', profileId: 'main' });
  const branch = store.createRootBranch('owner-a', canvas.id);
  const reservation = store.prepareSend('owner-a', { branchId: branch.id, userInput: 'run', attachments: [] });
  const interaction = store.acknowledgeSend('owner-a', reservation.id, 'run-1');
  return store.recordInteractionApproval(
    interaction.id,
    'openclaw',
    { runtimeId: 'openclaw', schemaVersion: 1, opaque: { approvalId: 'native-1' } },
    {
      category: 'command',
      title: 'Execute command',
      risk: 'high',
      permissions: [{ id: 'execute', label: 'Execute' }],
      choices: [
        { id: 'allow-always', intent: 'grant', scope: 'persistent', label: 'Always allow', requiresConfirmation: true },
        { id: 'deny', intent: 'deny', scope: 'item', label: 'Deny', requiresConfirmation: false },
      ],
    },
  )!;
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-approval-route-'));
  mocks.resolveApproval.mockReset();
});

afterEach(async () => {
  resetStore?.();
  resetStore = null;
  vi.restoreAllMocks();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('Canvas approval resolution route', () => {
  it('requires explicit confirmation for persistent choices before calling the Runtime', async () => {
    const { app, db } = await setup();
    const approval = seedApproval(db);

    const rejected = await app.request(`/api/canvas/approvals/${approval.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choiceId: 'allow-always', grantedPermissionIds: ['execute'] }),
    });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({ error: 'approval_confirmation_required' });
    expect(mocks.resolveApproval).not.toHaveBeenCalled();

    mocks.resolveApproval.mockResolvedValue({
      outcome: 'accepted',
      resolution: { choiceId: 'allow-always', grantedPermissionIds: ['execute'] },
    });
    const accepted = await app.request(`/api/canvas/approvals/${approval.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        choiceId: 'allow-always',
        grantedPermissionIds: ['execute'],
        confirmed: true,
      }),
    });
    expect(accepted.status).toBe(200);
    expect(db.getCanvasStore().getOwnedInteractionApproval('owner-a', approval.id))
      .toMatchObject({ status: 'resolved' });
  });

  it('marks an unexpected post-dispatch failure as unconfirmed instead of claiming success', async () => {
    const { app, db } = await setup();
    const approval = seedApproval(db);
    mocks.resolveApproval.mockRejectedValue(new Error('connection lost after send'));

    const response = await app.request(`/api/canvas/approvals/${approval.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choiceId: 'deny' }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ error: 'approval_resolution_unconfirmed' });
    expect(db.getCanvasStore().getOwnedInteractionApproval('owner-a', approval.id))
      .toMatchObject({ status: 'unconfirmed', error: 'connection lost after send' });
  });
});
