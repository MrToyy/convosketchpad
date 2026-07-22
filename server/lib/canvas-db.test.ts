import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CanvasStore } from './canvas-db.js';

const cleanups: Array<() => void> = [];

function createStore(): CanvasStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'nerve-canvas-'));
  const store = new CanvasStore(path.join(dir, 'canvas.sqlite'));
  cleanups.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

function seedUser(store: CanvasStore, id = 'user-a') {
  store.ensureUser(id, id);
  return store.createCanvas(id, 'Test Canvas', 'main');
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe('CanvasStore', () => {
  it('keeps Canvas rows isolated by owner', () => {
    const store = createStore();
    const canvas = seedUser(store);
    store.ensureUser('user-b', 'User B');

    expect(store.listCanvases('user-a')).toHaveLength(1);
    expect(store.listCanvases('user-b')).toHaveLength(0);
    expect(store.getGraph('user-b', canvas.id)).toBeNull();
  });

  it('does not materialize a root branch until send acknowledgement', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);

    expect(branch.sessionState).toBe('draft');
    expect(branch.headInteractionId).toBeNull();

    const reservation = store.prepareSend('user-a', {
      branchId: branch.id,
      userInput: 'hello',
      attachments: [],
    });
    expect(reservation.materialization).toBe('lazy-root');

    const interaction = store.acknowledgeSend('user-a', reservation.id, 'run-1');
    expect(interaction.status).toBe('streaming');
    const graph = store.getGraph('user-a', canvas.id)!;
    expect(graph.branches[0].sessionState).toBe('active');
    expect(graph.branches[0].headInteractionId).toBe(interaction.id);
  });

  it('continues the current session only when the expected head matches', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const firstReservation = store.prepareSend('user-a', { branchId: branch.id, userInput: 'one', attachments: [] });
    const first = store.acknowledgeSend('user-a', firstReservation.id, 'run-1');
    store.completeInteraction('user-a', first.id, { status: 'completed', agentOutput: 'answer one', artifacts: [] });

    expect(() => store.prepareSend('user-a', {
      branchId: branch.id,
      expectedHeadInteractionId: '00000000-0000-4000-8000-000000000000',
      userInput: 'stale',
      attachments: [],
    })).toThrow('invalid_branch_transition');

    const next = store.prepareSend('user-a', {
      branchId: branch.id,
      expectedHeadInteractionId: first.id,
      userInput: 'two',
      attachments: [],
    });
    expect(next.materialization).toBe('continue-existing');
    expect(next.sessionKey).toBe(branch.sessionKey);
  });

  it('allows fork only from completed non-head history and freezes that history', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const root = store.createRootBranch('user-a', canvas.id);
    const firstReservation = store.prepareSend('user-a', {
      branchId: root.id,
      userInput: 'one',
      attachments: [{ id: 'upload-1', name: 'source.png', mimeType: 'image/png', sizeBytes: 10, uri: 'file:///workspace/source.png', workspacePath: 'source.png' }],
    });
    const first = store.acknowledgeSend('user-a', firstReservation.id, 'run-1');
    store.completeInteraction('user-a', first.id, {
      status: 'completed',
      agentOutput: 'answer one',
      artifacts: [{ name: 'result.png', mimeType: 'image/png', uri: '/api/chat/media/outgoing/session/result/full' }],
    });

    expect(() => store.forkInteraction('user-a', first.id)).toThrow('cannot_fork_branch_head');

    const secondReservation = store.prepareSend('user-a', {
      branchId: root.id, expectedHeadInteractionId: first.id, userInput: 'two', attachments: [],
    });
    const second = store.acknowledgeSend('user-a', secondReservation.id, 'run-2');
    store.completeInteraction('user-a', second.id, { status: 'completed', agentOutput: 'answer two', artifacts: [] });

    const fork = store.forkInteraction('user-a', first.id);
    const forkReservation = store.prepareSend('user-a', { branchId: fork.id, userInput: 'alternative', attachments: [] });
    expect(forkReservation.materialization).toBe('canonical-replay');
    expect(forkReservation.outgoingMessage).toContain('answer one');
    expect(forkReservation.outgoingMessage).not.toContain('answer two');
    expect(forkReservation.bootstrapResources).toHaveLength(2);
    expect(forkReservation.bootstrapResources.map((resource) => resource.source)).toEqual(['user_attachment', 'agent_artifact']);
    expect(forkReservation.outgoingMessage).toContain('canvas-context-resources');
  });

  it('records non-blocking Fork resource warnings on the new Interaction', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const root = store.createRootBranch('user-a', canvas.id);
    const firstReservation = store.prepareSend('user-a', { branchId: root.id, userInput: 'one', attachments: [] });
    const first = store.acknowledgeSend('user-a', firstReservation.id, 'run-1');
    store.completeInteraction('user-a', first.id, { status: 'completed', agentOutput: 'one', artifacts: [] });
    const secondReservation = store.prepareSend('user-a', { branchId: root.id, expectedHeadInteractionId: first.id, userInput: 'two', attachments: [] });
    const second = store.acknowledgeSend('user-a', secondReservation.id, 'run-2');
    store.completeInteraction('user-a', second.id, { status: 'completed', agentOutput: 'two', artifacts: [] });

    const fork = store.forkInteraction('user-a', first.id);
    const reservation = store.prepareSend('user-a', { branchId: fork.id, userInput: 'alternative', attachments: [] });
    const interaction = store.acknowledgeSend('user-a', reservation.id, 'run-fork', ['source.png：读取失败']);

    expect(interaction.sessionMetadata.bootstrapWarnings).toEqual(['source.png：读取失败']);
  });

  it('deduplicates unresolved root and fork composers', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const root = store.createRootBranch('user-a', canvas.id);
    expect(store.createRootBranch('user-a', canvas.id).id).toBe(root.id);

    const firstReservation = store.prepareSend('user-a', { branchId: root.id, userInput: 'one', attachments: [] });
    const first = store.acknowledgeSend('user-a', firstReservation.id, 'run-1');
    store.completeInteraction('user-a', first.id, { status: 'completed', agentOutput: 'one', artifacts: [] });
    const secondReservation = store.prepareSend('user-a', { branchId: root.id, expectedHeadInteractionId: first.id, userInput: 'two', attachments: [] });
    const second = store.acknowledgeSend('user-a', secondReservation.id, 'run-2');
    store.completeInteraction('user-a', second.id, { status: 'completed', agentOutput: 'two', artifacts: [] });

    const fork = store.forkInteraction('user-a', first.id);
    expect(store.forkInteraction('user-a', first.id).id).toBe(fork.id);
  });

  it('stores reconciliation metadata without discarding Session metadata', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const reservation = store.prepareSend('user-a', { branchId: branch.id, userInput: 'one', attachments: [] });
    const current = store.acknowledgeSend('user-a', reservation.id, 'run-1');

    store.updateReconciliationMetadata(current.id, { version: 1, phase: 'settling', artifactSync: 'pending' });
    const updated = store.getOwnedInteraction('user-a', current.id)!;

    expect(updated.sessionMetadata.materialization).toBe('lazy-root');
    expect(updated.sessionMetadata.sessionKey).toBe(branch.sessionKey);
    expect(updated.sessionMetadata.reconciliation).toMatchObject({ version: 1, phase: 'settling', artifactSync: 'pending' });
    expect(store.getOwnedInteraction('user-b', current.id)).toBeNull();
  });

  it('finds unfinished and legacy interactions for idempotent reconciliation', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const reservation = store.prepareSend('user-a', { branchId: branch.id, userInput: 'one', attachments: [] });
    const current = store.acknowledgeSend('user-a', reservation.id, 'run-1');

    expect(store.listReconciliationCandidates().map((item) => item.id)).toContain(current.id);
    store.applyReconciledInteraction(current.id, {
      status: 'completed',
      agentOutput: 'done',
      artifacts: [],
      reconciliation: { version: 3, phase: 'synced', artifactSync: 'synced' },
    });
    expect(store.listReconciliationCandidates().map((item) => item.id)).not.toContain(current.id);
  });
});
