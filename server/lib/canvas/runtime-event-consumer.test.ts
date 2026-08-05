import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  signalTerminal: vi.fn(),
  publishChanged: vi.fn(),
  publishPreview: vi.fn(),
}));

let tempRoot = '';
let resetStore: (() => void) | null = null;

async function setup() {
  vi.resetModules();
  vi.doMock('../config.js', () => ({
    config: { canvasDatabasePath: path.join(tempRoot, 'canvas.sqlite') },
  }));
  vi.doMock('../canvas-reconciler.js', () => ({
    scheduleCanvasInteractionReconciliation: mocks.schedule,
    signalCanvasInteractionTerminal: mocks.signalTerminal,
  }));
  vi.doMock('../canvas-sync.js', () => ({
    publishCanvasChanged: mocks.publishChanged,
    publishCanvasPreview: mocks.publishPreview,
  }));
  const db = await import('../canvas-db.js');
  const consumer = await import('./runtime-event-consumer.js');
  resetStore = db.resetCanvasStoreForTests;
  return { db, consumer };
}

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), 'convosketchpad-runtime-event-'));
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

afterEach(() => {
  resetStore?.();
  resetStore = null;
  vi.restoreAllMocks();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('Canvas Runtime event consumer', () => {
  it('deduplicates durable terminal events and schedules reconciliation once', async () => {
    const { db, consumer } = await setup();
    const store = db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Canvas', { runtimeId: 'openclaw', profileId: 'main' });
    const branch = store.createRootBranch('owner-a', canvas.id);
    const reservation = store.prepareSend('owner-a', { branchId: branch.id, userInput: 'hello', attachments: [] });
    const turnRef = { runtimeId: 'openclaw', schemaVersion: 1, opaque: { runId: 'run-1' } };
    const interaction = store.acknowledgeSend('owner-a', reservation.id, null, [], turnRef);
    const event = {
      runtimeId: 'openclaw',
      eventId: 'terminal-1',
      type: 'turn.completed' as const,
      conversationRef: reservation.conversationRef || undefined,
      turnRef,
      text: 'done',
      createdAt: 1,
    };

    consumer.handleCanvasRuntimeEvent(event);
    consumer.handleCanvasRuntimeEvent(event);

    expect(mocks.signalTerminal).toHaveBeenCalledOnce();
    expect(mocks.signalTerminal).toHaveBeenCalledWith(interaction.id, 'owner-a', {});
    expect(mocks.schedule).toHaveBeenCalledOnce();
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM runtime_event_inbox').get())
      .toEqual({ count: 1 });
  });

  it('namespaces durable event IDs by Runtime', async () => {
    const { db, consumer } = await setup();
    const store = db.getCanvasStore();

    for (const runtimeId of ['openclaw', 'codex']) {
      consumer.handleCanvasRuntimeEvent({
        runtimeId,
        eventId: 'shared-native-id',
        type: 'turn.completed',
        text: 'done',
        createdAt: 1,
      });
    }

    expect(store.db.prepare('SELECT event_key FROM runtime_event_inbox ORDER BY event_key').all())
      .toEqual([
        { event_key: 'codex:shared-native-id' },
        { event_key: 'openclaw:shared-native-id' },
      ]);
  });

  it('does not fall back to another active turn when an explicit turn reference is unmatched', async () => {
    const { db, consumer } = await setup();
    const store = db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Canvas', { runtimeId: 'openclaw', profileId: 'main' });
    const branch = store.createRootBranch('owner-a', canvas.id);
    const reservation = store.prepareSend('owner-a', { branchId: branch.id, userInput: 'hello', attachments: [] });
    const activeTurn = { runtimeId: 'openclaw', schemaVersion: 1, opaque: { runId: 'active' } };
    store.acknowledgeSend('owner-a', reservation.id, null, [], activeTurn);

    consumer.handleCanvasRuntimeEvent({
      runtimeId: 'openclaw',
      eventId: 'old-terminal',
      type: 'turn.completed',
      conversationRef: reservation.conversationRef || undefined,
      turnRef: { runtimeId: 'openclaw', schemaVersion: 1, opaque: { runId: 'old' } },
      text: 'old result',
      createdAt: 2,
    });

    expect(mocks.signalTerminal).not.toHaveBeenCalled();
    expect(store.db.prepare('SELECT processed_at FROM runtime_event_inbox WHERE event_key = ?')
      .get('openclaw:old-terminal')).toEqual({ processed_at: null });
  });

  it('replays a durable approval that arrived before the Interaction was registered', async () => {
    const { db, consumer } = await setup();
    const store = db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Canvas', { runtimeId: 'openclaw', profileId: 'main' });
    const branch = store.createRootBranch('owner-a', canvas.id);
    const reservation = store.prepareSend('owner-a', { branchId: branch.id, userInput: 'run', attachments: [] });
    const turnRef = { runtimeId: 'openclaw', schemaVersion: 1, opaque: { runId: 'run-approval' } };
    consumer.handleCanvasRuntimeEvent({
      runtimeId: 'openclaw',
      eventId: 'approval-1',
      type: 'approval.required',
      conversationRef: reservation.conversationRef || undefined,
      turnRef,
      approvalRef: { runtimeId: 'openclaw', schemaVersion: 1, opaque: { approvalId: 'native-1' } },
      approval: {
        category: 'command',
        title: 'Execute command',
        risk: 'high',
        permissions: [{ id: 'execute', label: 'Execute' }],
        choices: [{
          id: 'allow-once', intent: 'grant', scope: 'item', label: 'Allow once', requiresConfirmation: false,
        }],
      },
      createdAt: 1,
    });
    const interaction = store.acknowledgeSend('owner-a', reservation.id, null, [], turnRef);

    consumer.registerCanvasInteraction(reservation, interaction, turnRef);

    expect(store.getOwnedInteraction('owner-a', interaction.id)?.approvals).toEqual([
      expect.objectContaining({ title: 'Execute command', status: 'pending' }),
    ]);
  });

  it('applies an approval resolution after its Interaction has already completed', async () => {
    const { db, consumer } = await setup();
    const store = db.getCanvasStore();
    store.ensureUser('owner-a', 'Owner A');
    const canvas = store.createCanvas('owner-a', 'Canvas', { runtimeId: 'openclaw', profileId: 'main' });
    const branch = store.createRootBranch('owner-a', canvas.id);
    const reservation = store.prepareSend('owner-a', { branchId: branch.id, userInput: 'run', attachments: [] });
    const turnRef = { runtimeId: 'openclaw', schemaVersion: 1, opaque: { runId: 'run-late-resolution' } };
    const approvalRef = { runtimeId: 'openclaw', schemaVersion: 1, opaque: { approvalId: 'native-late' } };
    const interaction = store.acknowledgeSend('owner-a', reservation.id, null, [], turnRef);
    store.recordInteractionApproval(interaction.id, 'openclaw', approvalRef, {
      category: 'command',
      title: 'Execute command',
      risk: 'high',
      permissions: [{ id: 'execute', label: 'Execute' }],
      choices: [{
        id: 'allow-once', intent: 'grant', scope: 'item', label: 'Allow once', requiresConfirmation: false,
      }],
    });
    store.db.prepare("UPDATE interactions SET execution_state = 'completed', status = 'completed' WHERE id = ?")
      .run(interaction.id);

    consumer.handleCanvasRuntimeEvent({
      runtimeId: 'openclaw',
      eventId: 'approval-resolved-late',
      type: 'approval.resolved',
      conversationRef: reservation.conversationRef || undefined,
      turnRef,
      approvalRef,
      resolution: { choiceId: 'allow-once', grantedPermissionIds: ['execute'] },
      resolvedBy: 'runtime',
      createdAt: 3,
    });

    expect(store.getOwnedInteraction('owner-a', interaction.id)?.approvals)
      .toEqual([expect.objectContaining({ status: 'resolved', resolvedBy: 'runtime' })]);
    expect(mocks.publishChanged).toHaveBeenCalledWith('owner-a', canvas.id);
    expect(store.db.prepare('SELECT processed_at FROM runtime_event_inbox WHERE event_key = ?')
      .get('openclaw:approval-resolved-late')).toEqual({ processed_at: expect.any(Number) });
  });

  it('keeps transient disconnection status out of the durable Canvas inbox', async () => {
    const { db, consumer } = await setup();
    const store = db.getCanvasStore();

    consumer.handleCanvasRuntimeEvent({
      runtimeId: 'openclaw',
      eventId: 'disconnect-1',
      type: 'runtime.disconnected',
      error: 'offline',
      createdAt: 1,
    });

    expect(store.db.prepare('SELECT COUNT(*) AS count FROM runtime_event_inbox').get())
      .toEqual({ count: 0 });
  });
});
