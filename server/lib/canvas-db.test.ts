import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { CanvasStore, type CanvasArtifact } from './canvas-db.js';

const cleanups: Array<() => void> = [];

function createStoreFixture(): { store: CanvasStore; databasePath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-canvas-'));
  const databasePath = path.join(dir, 'canvas.sqlite');
  const store = new CanvasStore(databasePath);
  cleanups.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, databasePath };
}

function createStore(): CanvasStore {
  return createStoreFixture().store;
}

function seedUser(store: CanvasStore, id = 'user-a') {
  store.ensureUser(id, id);
  return store.createCanvas(id, 'Test Canvas', 'main');
}

function completeInteractionForTest(
  store: CanvasStore,
  ownerId: string,
  interactionId: string,
  input: {
    status: 'completed' | 'failed';
    agentOutput: string;
    artifacts: CanvasArtifact[];
    metadata?: Record<string, unknown>;
  },
) {
  if (!store.getOwnedInteraction(ownerId, interactionId)) throw new Error('test interaction not found');
  return store.applyReconciledInteraction(interactionId, {
    status: input.status,
    agentOutput: input.agentOutput,
    artifacts: input.artifacts,
    artifactSyncState: 'synced',
    artifactObservationPending: false,
    error: input.status === 'failed' ? input.agentOutput || 'OpenClaw run failed' : null,
    reconciliation: {
      ...(input.metadata || {}),
      phase: 'synced',
      artifactSync: 'synced',
    },
  });
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe('CanvasStore', () => {
  it('deterministically migrates an exact v0.2.0 database without Gateway access', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-v020-canvas-'));
    const databasePath = path.join(dir, 'canvas.sqlite');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(readFileSync(new URL('./fixtures/canvas-v0.2.0.sql', import.meta.url), 'utf-8'));
    legacy.exec(`
      INSERT INTO canvas_users
        (id, display_name, token_hash, token_version, status, created_at, updated_at)
        VALUES ('user-a', 'User A', NULL, 1, 'unmanaged', 1, 1);
      INSERT INTO canvases VALUES ('canvas-1', 'user-a', 'Legacy', 'main', 1, 1);
      INSERT INTO branches
        (id, canvas_id, kind, session_key, session_state, head_interaction_id, created_at, updated_at)
        VALUES ('branch-1', 'canvas-1', 'root', 'agent:main:canvas:branch-1', 'active', 'streaming', 1, 50);
    `);
    const insertInteraction = legacy.prepare(`INSERT INTO interactions
      (id, branch_id, run_id, user_input, agent_output, status, attachments_json,
        artifacts_json, session_metadata_json, created_at, updated_at)
      VALUES (?, 'branch-1', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertInteraction.run(
      'text-only',
      'run-text',
      'text',
      'done',
      'completed',
      '[]',
      '[]',
      '{"reconciliation":{"version":4,"artifactSync":"degraded","artifactWarnings":["stale"]}}',
      10,
      11,
    );
    insertInteraction.run(
      'deduplicated',
      'run-image',
      'image',
      'done',
      'completed',
      JSON.stringify([{
        id: 'attachment-1',
        name: 'source.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        storage: 'canvas',
      }]),
      JSON.stringify([
        {
          id: 'failed-copy',
          name: 'result.png',
          uri: '/Users/example/result.png',
          sourceUri: '/Users/example/result.png',
          storage: 'source',
          available: false,
          warning: 'source is not allowed',
        },
        {
          id: 'canvas-copy',
          name: 'result.png',
          uri: '/api/canvas/artifacts/canvas-1/deduplicated/canvas-copy',
          sourceUri: '/api/files?path=%2FUsers%2Fexample%2Fresult.png',
          storage: 'canvas',
          available: true,
        },
      ]),
      '{"reconciliation":{"version":4,"artifactSync":"degraded"}}',
      20,
      21,
    );
    insertInteraction.run(
      'unavailable',
      'run-missing',
      'missing',
      'done',
      'completed',
      '[]',
      JSON.stringify([{
        id: 'missing-copy',
        name: 'missing.txt',
        uri: '/missing.txt',
        storage: 'source',
        available: false,
        warning: 'missing',
      }]),
      '{}',
      30,
      31,
    );
    insertInteraction.run(
      'failed',
      'run-failed',
      'fail',
      'OpenClaw failed',
      'failed',
      '[]',
      '[]',
      '{}',
      40,
      41,
    );
    insertInteraction.run(
      'streaming',
      'run-streaming',
      'continue',
      '',
      'streaming',
      '[]',
      '[]',
      '{}',
      50,
      50,
    );
    legacy.prepare(`INSERT INTO send_reservations
      (id, branch_id, user_input, materialization, session_key, outgoing_message,
        status, created_at, updated_at)
      VALUES ('send-1', 'branch-1', 'continue', 'continue-existing',
        'agent:main:canvas:branch-1', 'continue', 'prepared', 50, 50)`).run();
    legacy.close();

    const store = new CanvasStore(databasePath);
    cleanups.push(() => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    });

    expect(store.getOwnedInteraction('user-a', 'text-only')).toMatchObject({
      executionState: 'completed',
      artifactSyncState: 'synced',
      artifacts: [],
    });
    expect(store.getOwnedInteraction('user-a', 'deduplicated')).toMatchObject({
      executionState: 'completed',
      artifactSyncState: 'synced',
      artifacts: [expect.objectContaining({ id: 'canvas-copy', available: true })],
    });
    expect(store.getOwnedInteraction('user-a', 'unavailable')).toMatchObject({
      executionState: 'completed',
      artifactSyncState: 'degraded',
      artifacts: [expect.objectContaining({ id: 'missing-copy', available: false })],
    });
    expect(store.getOwnedInteraction('user-a', 'failed')).toMatchObject({
      executionState: 'failed',
      artifactSyncState: 'synced',
      error: 'OpenClaw failed',
    });
    expect(store.getOwnedInteraction('user-a', 'streaming')).toMatchObject({
      executionState: 'unconfirmed',
      artifactSyncState: 'observing',
    });
    expect(store.listReconciliationCandidates().map((item) => item.id)).toEqual(['streaming']);
    expect(store.getCanvasAttachmentDeliveries('canvas-1', ['attachment-1'])).toHaveLength(1);
    expect(store.getReservation('send-1')).toMatchObject({ dispatchState: 'ambiguous' });
    expect(store.db.prepare(`SELECT COUNT(*) AS count FROM schema_migrations
      WHERE id = '0.2.0_to_0.3.0_v1'`).get()).toMatchObject({ count: 1 });

    const before = store.db.prepare(`SELECT
      (SELECT COUNT(*) FROM interaction_artifacts) AS artifacts,
      (SELECT COUNT(*) FROM artifact_sync_jobs) AS jobs,
      (SELECT COUNT(*) FROM schema_migrations) AS migrations`).get();
    const reopened = new CanvasStore(databasePath);
    const after = reopened.db.prepare(`SELECT
      (SELECT COUNT(*) FROM interaction_artifacts) AS artifacts,
      (SELECT COUNT(*) FROM artifact_sync_jobs) AS jobs,
      (SELECT COUNT(*) FROM schema_migrations) AS migrations`).get();
    expect(after).toEqual(before);
    reopened.close();
  });

  it('migrates legacy Interaction JSON into explicit states and normalized Artifacts', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-legacy-canvas-'));
    const databasePath = path.join(dir, 'canvas.sqlite');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE canvas_users (
        id TEXT PRIMARY KEY, display_name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE canvases (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES canvas_users(id), name TEXT NOT NULL,
        agent_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE branches (
        id TEXT PRIMARY KEY, canvas_id TEXT NOT NULL REFERENCES canvases(id), kind TEXT NOT NULL,
        parent_branch_id TEXT, forked_from_interaction_id TEXT, session_key TEXT NOT NULL UNIQUE,
        session_state TEXT NOT NULL, head_interaction_id TEXT, snapshot_json TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE interactions (
        id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES branches(id), parent_interaction_id TEXT,
        run_id TEXT, user_input TEXT NOT NULL, agent_output TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL, attachments_json TEXT NOT NULL DEFAULT '[]',
        artifacts_json TEXT NOT NULL DEFAULT '[]', session_metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO canvas_users VALUES ('user-a', 'User A', 1, 1);
      INSERT INTO canvases VALUES ('canvas-1', 'user-a', 'Legacy', 'main', 1, 1);
      INSERT INTO branches
        (id, canvas_id, kind, session_key, session_state, head_interaction_id, created_at, updated_at)
        VALUES ('branch-1', 'canvas-1', 'root', 'agent:main:canvas:branch-1', 'active', 'interaction-1', 1, 1);
      INSERT INTO interactions
        (id, branch_id, run_id, user_input, agent_output, status, artifacts_json, session_metadata_json, created_at, updated_at)
        VALUES (
          'interaction-1', 'branch-1', 'run-1', 'hello', 'done', 'completed',
          '[{"id":"artifact-1","name":"result.txt","uri":"/result.txt","storage":"canvas"}]',
          '{"reconciliation":{"version":5,"artifactSync":"synced","terminalAt":2}}',
          1, 2
        );
    `);
    legacy.close();
    const store = new CanvasStore(databasePath);
    cleanups.push(() => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    });

    expect(store.getOwnedInteraction('user-a', 'interaction-1')).toMatchObject({
      executionState: 'completed',
      artifactSyncState: 'synced',
      terminalAt: 2,
      artifacts: [{ id: 'artifact-1', name: 'result.txt', uri: '/result.txt' }],
    });
    expect(store.listReconciliationCandidates()).toEqual([]);
    expect(store.db.prepare(`SELECT app_version FROM schema_migrations
      WHERE id = '0.2.0_to_0.3.0_v1'`).get()).toMatchObject({
      app_version: expect.any(String),
    });

    store.applyReconciledInteraction('interaction-1', {
      status: 'completed',
      agentOutput: 'done',
      artifacts: [{
        id: 'artifact-canonical',
        name: 'result.txt',
        uri: '/api/canvas/artifacts/canvas-1/interaction-1/artifact-canonical',
        storage: 'canvas',
        available: true,
      }],
      reconciliation: { version: 8, artifactSync: 'synced' },
    });
    const reopened = new CanvasStore(databasePath);
    expect(reopened.getOwnedInteraction('user-a', 'interaction-1')?.artifacts).toEqual([
      expect.objectContaining({ id: 'artifact-canonical' }),
    ]);
    reopened.close();
  });

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

  it('keeps queued and ambiguous sends in the Canvas graph until acknowledgement', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const reservation = store.prepareSend('user-a', {
      branchId: branch.id,
      userInput: 'hello',
      attachments: [],
    });

    expect(reservation).toMatchObject({ dispatchState: 'reserved', attemptCount: 0 });
    expect(store.getGraph('user-a', canvas.id)?.pendingSends).toEqual([
      expect.objectContaining({ id: reservation.id, dispatchState: 'reserved' }),
    ]);
    expect(store.nextDispatchableReservationAt()).toBeLessThanOrEqual(Date.now());

    store.markReservationDispatching(reservation.id);
    const retryAt = Date.now() + 60_000;
    const ambiguous = store.scheduleReservationRetry(
      reservation.id,
      'ambiguous',
      'connection closed after send',
      retryAt,
    );
    expect(ambiguous).toMatchObject({
      dispatchState: 'ambiguous',
      attemptCount: 1,
      error: 'connection closed after send',
    });
    expect(store.nextDispatchableReservationAt()).toBe(retryAt);
    expect(() => store.prepareSend('user-a', {
      branchId: branch.id,
      userInput: 'duplicate',
      attachments: [],
    })).toThrow('send_in_progress');

    store.acknowledgeSend('user-a', reservation.id, 'run-1');
    expect(store.getGraph('user-a', canvas.id)?.pendingSends).toEqual([]);
    expect(store.nextDispatchableReservationAt()).toBeNull();
  });

  it('resolves attachment IDs from the owner-scoped registry and keeps delivery metadata separate', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const attachment = {
      id: 'a'.repeat(40),
      name: 'source.png',
      mimeType: 'image/png',
      sizeBytes: 2_000_000,
      uri: `/api/canvas/attachments/${canvas.id}/${'a'.repeat(40)}`,
      storage: 'canvas' as const,
      available: true,
    };
    store.recordCanvasAttachment('user-a', canvas.id, attachment);
    store.setCanvasAttachmentDeliveryVariant('user-a', canvas.id, attachment.id, {
      ...attachment,
      id: 'b'.repeat(40),
      mimeType: 'image/webp',
      sizeBytes: 500_000,
    });

    expect(store.getOwnedCanvasAttachments('user-a', canvas.id, [attachment.id])).toEqual([
      expect.objectContaining({ id: attachment.id, name: 'source.png', mimeType: 'image/png' }),
    ]);
    expect(store.getOwnedCanvasAttachments('user-b', canvas.id, [attachment.id])).toEqual([]);
    expect(store.getCanvasAttachmentDeliveries(canvas.id, [attachment.id])).toEqual([
      expect.objectContaining({
        deliveryAttachmentId: 'b'.repeat(40),
        deliveryMimeType: 'image/webp',
        deliverySizeBytes: 500_000,
      }),
    ]);
  });

  it('changes the Canvas Agent and rewrites every draft branch session key before the first interaction', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const root = store.createRootBranch('user-a', canvas.id);

    const updated = store.updateCanvasAgentBeforeFirstInteraction('user-a', canvas.id, 'designer');

    expect(updated?.agentId).toBe('designer');
    expect(store.getGraph('user-a', canvas.id)?.branches).toEqual([
      expect.objectContaining({ id: root.id, sessionKey: `agent:designer:canvas:${root.id}`, sessionState: 'draft' }),
    ]);
  });

  it('locks the Canvas Agent as soon as a send is prepared or an interaction exists', () => {
    const store = createStore();
    const preparedCanvas = seedUser(store);
    const preparedBranch = store.createRootBranch('user-a', preparedCanvas.id);
    store.prepareSend('user-a', { branchId: preparedBranch.id, userInput: 'hello', attachments: [] });

    expect(() => store.updateCanvasAgentBeforeFirstInteraction('user-a', preparedCanvas.id, 'designer')).toThrow('agent_locked');

    const activeCanvas = store.createCanvas('user-a', 'Active Canvas', 'main');
    const activeBranch = store.createRootBranch('user-a', activeCanvas.id);
    const reservation = store.prepareSend('user-a', { branchId: activeBranch.id, userInput: 'hello', attachments: [] });
    store.acknowledgeSend('user-a', reservation.id, 'run-active');

    expect(() => store.updateCanvasAgentBeforeFirstInteraction('user-a', activeCanvas.id, 'designer')).toThrow('agent_locked');
  });

  it('continues the current session only when the expected head matches', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const firstReservation = store.prepareSend('user-a', { branchId: branch.id, userInput: 'one', attachments: [] });
    const first = store.acknowledgeSend('user-a', firstReservation.id, 'run-1');
    completeInteractionForTest(store, 'user-a', first.id, { status: 'completed', agentOutput: 'answer one', artifacts: [] });

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

  it('recovers canonical branch context when OpenClaw replaces the session behind a stable key', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const firstReservation = store.prepareSend('user-a', { branchId: branch.id, userInput: 'one', attachments: [] });
    const first = store.acknowledgeSend('user-a', firstReservation.id, 'run-1');
    completeInteractionForTest(store, 'user-a', first.id, { status: 'completed', agentOutput: 'answer one', artifacts: [] });

    expect(store.observeBranchSession(branch.id, 'session-1')?.sessionIntegrity).toBe('healthy');
    expect(store.observeBranchSession(branch.id, 'session-2')?.sessionIntegrity).toBe('drifted');

    const recovery = store.prepareSend('user-a', {
      branchId: branch.id,
      expectedHeadInteractionId: first.id,
      userInput: 'two',
      attachments: [],
    });
    expect(recovery.materialization).toBe('session-recovery');
    expect(recovery.outgoingMessage).toContain('canvas-context-snapshot');
    expect(recovery.outgoingMessage).toContain('answer one');

    store.acknowledgeSend('user-a', recovery.id, 'run-2');
    const recoveredBranch = store.getGraph('user-a', canvas.id)!.branches[0];
    expect(recoveredBranch).toMatchObject({
      openClawSessionId: 'session-2',
      observedSessionId: 'session-2',
      sessionIntegrity: 'healthy',
    });
  });

  it('proactively recovers a session and advances lifecycle timestamps on acknowledgement', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const firstReservation = store.prepareSend('user-a', {
      branchId: branch.id,
      userInput: 'one',
      attachments: [],
    });
    const first = store.acknowledgeSend('user-a', firstReservation.id, 'run-1');
    completeInteractionForTest(store, 'user-a', first.id, {
      status: 'completed',
      agentOutput: 'answer one',
      artifacts: [],
    });

    store.observeBranchSession(branch.id, 'session-1', 1_000);
    store.observeBranchSession(branch.id, 'session-1', 2_000);
    expect(store.getOwnedBranchSessionLifecycle('user-a', branch.id)).toMatchObject({
      sessionStartedAt: 1_000,
      observedSessionStartedAt: 1_000,
    });

    const recovery = store.prepareSend('user-a', {
      branchId: branch.id,
      expectedHeadInteractionId: first.id,
      userInput: 'two',
      attachments: [],
      forceSessionRecovery: true,
    });
    expect(recovery.materialization).toBe('session-recovery');

    store.observeBranchSession(branch.id, 'session-2', 3_000);
    expect(store.getOwnedReservationSessionTarget('user-a', recovery.id)).toEqual({
      branchId: branch.id,
      sessionKey: branch.sessionKey,
    });
    expect(store.getOwnedReservationSessionTarget('user-b', recovery.id)).toBeNull();

    store.acknowledgeSend('user-a', recovery.id, 'run-2');
    expect(store.getOwnedBranchSessionLifecycle('user-a', branch.id)).toMatchObject({
      sessionStartedAt: 3_000,
      observedSessionStartedAt: 3_000,
    });
    expect(store.getGraph('user-a', canvas.id)!.branches[0]).toMatchObject({
      openClawSessionId: 'session-2',
      sessionIntegrity: 'healthy',
    });
  });

  it('recovers context when a previously observed OpenClaw session disappears', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const firstReservation = store.prepareSend('user-a', { branchId: branch.id, userInput: 'one', attachments: [] });
    const first = store.acknowledgeSend('user-a', firstReservation.id, 'run-1');
    completeInteractionForTest(store, 'user-a', first.id, { status: 'completed', agentOutput: 'answer one', artifacts: [] });
    store.observeBranchSession(branch.id, 'session-1');

    expect(store.markBranchSessionMissing(branch.id)?.sessionIntegrity).toBe('drifted');
    const recovery = store.prepareSend('user-a', {
      branchId: branch.id,
      expectedHeadInteractionId: first.id,
      userInput: 'two',
      attachments: [],
    });
    expect(recovery.materialization).toBe('session-recovery');
    expect(recovery.outgoingMessage).toContain('answer one');

    store.acknowledgeSend('user-a', recovery.id, 'run-2');
    expect(store.getGraph('user-a', canvas.id)!.branches[0]).toMatchObject({
      openClawSessionId: null,
      observedSessionId: null,
      sessionIntegrity: 'unknown',
    });
  });

  it('allows fork only from completed non-head history and freezes that history', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const root = store.createRootBranch('user-a', canvas.id);
    const firstReservation = store.prepareSend('user-a', {
      branchId: root.id,
      userInput: 'one',
      attachments: [{
        id: 'a'.repeat(40),
        name: 'source.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        uri: `/api/canvas/attachments/${canvas.id}/${'a'.repeat(40)}`,
        storage: 'canvas',
        available: true,
      }],
    });
    const first = store.acknowledgeSend('user-a', firstReservation.id, 'run-1');
    completeInteractionForTest(store, 'user-a', first.id, {
      status: 'completed',
      agentOutput: 'answer one',
      artifacts: [{
        id: 'b'.repeat(40),
        name: 'result.png',
        mimeType: 'image/png',
        uri: `/api/canvas/artifacts/${canvas.id}/${first.id}/${'b'.repeat(40)}`,
        storage: 'canvas',
        available: true,
      }],
    });

    expect(() => store.forkInteraction('user-a', first.id)).toThrow('cannot_fork_branch_head');

    const secondReservation = store.prepareSend('user-a', {
      branchId: root.id, expectedHeadInteractionId: first.id, userInput: 'two', attachments: [],
    });
    const second = store.acknowledgeSend('user-a', secondReservation.id, 'run-2');
    completeInteractionForTest(store, 'user-a', second.id, { status: 'completed', agentOutput: 'answer two', artifacts: [] });

    const fork = store.forkInteraction('user-a', first.id);
    const forkReservation = store.prepareSend('user-a', { branchId: fork.id, userInput: 'alternative', attachments: [] });
    expect(forkReservation.materialization).toBe('canonical-replay');
    expect(forkReservation.outgoingMessage).toContain('answer one');
    expect(forkReservation.outgoingMessage).not.toContain('answer two');
    expect(forkReservation.bootstrapResources).toHaveLength(2);
    expect(forkReservation.bootstrapResources.map((resource) => resource.source)).toEqual(['user_attachment', 'agent_artifact']);
    expect(forkReservation.outgoingMessage).toContain('canvas-context-resources');

    const resource = forkReservation.bootstrapResources[0];
    expect(store.markReservationAwaitingMedia(forkReservation.id)?.dispatchState).toBe('awaiting_media');
    expect(store.setReservationResourceVariant('user-b', forkReservation.id, resource.id, {
      id: 'c'.repeat(40),
      name: resource.name,
      mimeType: 'image/webp',
      sizeBytes: 8,
    })).toBe(false);
    expect(store.setReservationResourceVariant('user-a', forkReservation.id, resource.id, {
      id: 'c'.repeat(40),
      name: resource.name,
      mimeType: 'image/webp',
      sizeBytes: 8,
    })).toBe(true);
    expect(store.getReservation(forkReservation.id)?.dispatchState).toBe('reserved');
    expect(store.getReservationResourceVariant(forkReservation.id, resource.id)).toEqual({
      attachmentId: 'c'.repeat(40),
      mimeType: 'image/webp',
      sizeBytes: 8,
    });
  });

  it('records non-blocking Fork resource warnings on the new Interaction', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const root = store.createRootBranch('user-a', canvas.id);
    const firstReservation = store.prepareSend('user-a', { branchId: root.id, userInput: 'one', attachments: [] });
    const first = store.acknowledgeSend('user-a', firstReservation.id, 'run-1');
    completeInteractionForTest(store, 'user-a', first.id, { status: 'completed', agentOutput: 'one', artifacts: [] });
    const secondReservation = store.prepareSend('user-a', { branchId: root.id, expectedHeadInteractionId: first.id, userInput: 'two', attachments: [] });
    const second = store.acknowledgeSend('user-a', secondReservation.id, 'run-2');
    completeInteractionForTest(store, 'user-a', second.id, { status: 'completed', agentOutput: 'two', artifacts: [] });

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
    completeInteractionForTest(store, 'user-a', first.id, { status: 'completed', agentOutput: 'one', artifacts: [] });
    const secondReservation = store.prepareSend('user-a', { branchId: root.id, expectedHeadInteractionId: first.id, userInput: 'two', attachments: [] });
    const second = store.acknowledgeSend('user-a', secondReservation.id, 'run-2');
    completeInteractionForTest(store, 'user-a', second.id, { status: 'completed', agentOutput: 'two', artifacts: [] });

    const fork = store.forkInteraction('user-a', first.id);
    expect(store.forkInteraction('user-a', first.id).id).toBe(fork.id);
  });

  it('stores reconciliation metadata without discarding Session metadata', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const reservation = store.prepareSend('user-a', { branchId: branch.id, userInput: 'one', attachments: [] });
    const current = store.acknowledgeSend('user-a', reservation.id, 'run-1');

    store.updateReconciliationMetadata(current.id, { phase: 'settling', artifactSync: 'pending' });
    const updated = store.getOwnedInteraction('user-a', current.id)!;

    expect(updated.sessionMetadata.materialization).toBe('lazy-root');
    expect(updated.sessionMetadata.sessionKey).toBe(branch.sessionKey);
    expect(updated.sessionMetadata.reconciliation).toMatchObject({ phase: 'settling', artifactSync: 'pending' });
    expect(store.getOwnedInteraction('user-b', current.id)).toBeNull();
  });

  it('finds unfinished, silently observed, and legacy interactions without reopening terminal records', () => {
    const { store, databasePath } = createStoreFixture();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const reservation = store.prepareSend('user-a', { branchId: branch.id, userInput: 'one', attachments: [] });
    const current = store.acknowledgeSend('user-a', reservation.id, 'run-1');

    expect(store.listReconciliationCandidates().map((item) => item.id)).toContain(current.id);
    store.applyReconciledInteraction(current.id, {
      status: 'completed',
      agentOutput: 'done',
      artifacts: [],
      reconciliation: { phase: 'synced', artifactSync: 'synced' },
    });
    expect(store.listReconciliationCandidates().map((item) => item.id)).not.toContain(current.id);

    store.applyReconciledInteraction(current.id, {
      status: 'completed',
      agentOutput: 'done',
      artifacts: [{
        name: 'result.png',
        uri: '/api/canvas/artifacts/canvas-1/interaction-1/artifact-1',
        storage: 'canvas',
        available: true,
      }],
      artifactSyncState: 'synced',
      artifactObservationPending: true,
      reconciliation: { phase: 'pending', artifactSync: 'pending' },
    });
    store.scheduleArtifactSyncAttempt(current.id, Date.now() + 60_000);
    expect(store.getOwnedInteraction('user-a', current.id)?.artifactSyncState).toBe('synced');
    expect(store.listReconciliationCandidates().map((item) => item.id)).toContain(current.id);
    const inspection = new DatabaseSync(databasePath);
    expect(inspection.prepare(`SELECT state, attempt_count, next_attempt_at
      FROM artifact_sync_jobs WHERE interaction_id = ?`).get(current.id)).toMatchObject({
      state: 'observing',
      attempt_count: 0,
      next_attempt_at: expect.any(Number),
    });
    store.markArtifactSyncAttempt(current.id);
    expect(inspection.prepare(`SELECT attempt_count, next_attempt_at
      FROM artifact_sync_jobs WHERE interaction_id = ?`).get(current.id)).toMatchObject({
      attempt_count: 1,
      next_attempt_at: null,
    });
    inspection.close();

    store.applyReconciledInteraction(current.id, {
      status: 'completed',
      agentOutput: 'done',
      artifacts: [],
      artifactObservationPending: false,
      reconciliation: { phase: 'synced', artifactSync: 'synced' },
    });
    expect(store.listReconciliationCandidates().map((item) => item.id)).not.toContain(current.id);

    store.applyReconciledInteraction(current.id, {
      status: 'completed',
      agentOutput: 'done',
      artifacts: [{ name: 'late.txt', uri: '/missing/late.txt', storage: 'source', available: false }],
      reconciliation: { phase: 'degraded', artifactSync: 'degraded' },
    });
    expect(store.listReconciliationCandidates().map((item) => item.id)).not.toContain(current.id);

    store.applyReconciledInteraction(current.id, {
      status: 'completed',
      agentOutput: '',
      artifacts: [],
      reconciliation: { phase: 'synced', artifactSync: 'synced' },
    });
    expect(store.listReconciliationCandidates().map((item) => item.id)).not.toContain(current.id);

    store.applyReconciledInteraction(current.id, {
      status: 'completed',
      agentOutput: 'done',
      artifacts: [],
      reconciliation: { phase: 'synced', artifactSync: 'synced' },
    });
    expect(store.listReconciliationCandidates().map((item) => item.id)).not.toContain(current.id);
  });

  it('persists Canvas cursors, coalesces full entity updates, and ignores metadata heartbeats', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const reservation = store.prepareSend('user-a', {
      branchId: branch.id,
      userInput: 'one',
      attachments: [],
    });
    const current = store.acknowledgeSend('user-a', reservation.id, 'run-1');
    const initial = store.getCanvasSyncBatch('user-a', canvas.id, 0)!;
    expect(initial.cursor).toBeGreaterThan(0);
    expect(initial.branches.map((item) => item.id)).toContain(branch.id);
    expect(initial.interactions.map((item) => item.id)).toContain(current.id);
    expect(initial.sendOperations).toEqual([
      expect.objectContaining({ id: reservation.id, dispatchState: 'acknowledged' }),
    ]);

    const cursor = initial.cursor;
    store.updateReconciliationMetadata(current.id, {
      phase: 'monitoring',
      lastCheckedAt: Date.now(),
    });
    expect(store.getCanvasCursor(canvas.id)).toBe(cursor);

    store.applyReconciledInteraction(current.id, {
      status: 'completed',
      agentOutput: 'done',
      artifacts: [],
      reconciliation: { phase: 'synced', artifactSync: 'synced' },
    });
    const terminal = store.getCanvasSyncBatch('user-a', canvas.id, cursor)!;
    expect(terminal.interactions).toEqual([
      expect.objectContaining({
        id: current.id,
        executionState: 'completed',
        artifactSyncState: 'synced',
        agentOutput: 'done',
      }),
    ]);
    const terminalCursor = terminal.cursor;
    store.applyReconciledInteraction(current.id, {
      status: 'completed',
      agentOutput: 'done',
      artifacts: [],
      reconciliation: { phase: 'synced', artifactSync: 'synced', lastCheckedAt: Date.now() },
    });
    expect(store.getCanvasCursor(canvas.id)).toBe(terminalCursor);
  });

  it('correlates Gateway signals by durable run identity and stores terminal signals idempotently', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const reservation = store.prepareSend('user-a', {
      branchId: branch.id,
      userInput: 'one',
      attachments: [],
    });
    const current = store.acknowledgeSend('user-a', reservation.id, 'run-1');
    expect(store.findInteractionByGatewayCorrelation('run-1', '')?.id).toBe(current.id);
    expect(store.findInteractionByGatewayCorrelation('', branch.sessionKey)?.id).toBe(current.id);

    const signal = {
      eventKey: 'chat:1',
      runId: 'run-1',
      sessionKey: branch.sessionKey,
      event: 'chat',
      payload: { state: 'final' },
      createdAt: Date.now(),
    };
    expect(store.recordGatewaySignal(signal)).toBe(true);
    expect(store.recordGatewaySignal(signal)).toBe(false);
    expect(store.listPendingGatewaySignals('run-1', '')).toEqual([
      expect.objectContaining({ eventKey: 'chat:1', payload: { state: 'final' } }),
    ]);
    store.markGatewaySignalProcessed('chat:1');
    expect(store.listPendingGatewaySignals('run-1', '')).toEqual([]);
  });
});
