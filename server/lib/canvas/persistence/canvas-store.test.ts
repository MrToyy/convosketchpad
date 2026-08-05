import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { runtimeHandle } from '../../agent-runtimes/contract.js';
import { CanvasStore } from './canvas-store.js';
import type { CanvasArtifact } from '../model.js';
import { testConversationHandleFactory } from '../../fixtures/test-conversation-handle.js';

const cleanups: Array<() => void> = [];

function createStoreFixture(): { store: CanvasStore; databasePath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-canvas-'));
  const databasePath = path.join(dir, 'canvas.sqlite');
  const store = new CanvasStore(databasePath, { createConversationHandle: testConversationHandleFactory });
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
  return store.createCanvas(id, 'Test Canvas', { runtimeId: 'openclaw', profileId: 'main' });
}

function observeConversationInstance(
  store: CanvasStore,
  branchId: string,
  instanceId: string,
  observedAt?: number,
) {
  const context = store.getOwnedBranchRuntimeContext('user-a', branchId);
  if (!context) throw new Error('test Runtime context not found');
  return store.observeBranchConversation(
    branchId,
    {
      ...context.conversationRef,
      opaque: { ...context.conversationRef.opaque, sessionId: instanceId },
    },
    instanceId,
    observedAt,
  );
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
  it('creates fresh databases directly at the current Runtime schema', () => {
    const store = createStore();
    const tableNames = (store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
      .map(({ name }) => name);
    const migrationIds = (store.db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as Array<{ id: string }>)
      .map(({ id }) => id);

    expect(tableNames).toEqual(expect.arrayContaining(['runtime_event_inbox', 'interaction_approvals']));
    expect(tableNames).not.toEqual(expect.arrayContaining(['gateway_signal_inbox', 'backend_event_inbox']));
    expect((store.db.prepare('PRAGMA table_info(canvases)').all() as Array<{ name: string }>)
      .map(({ name }) => name)).not.toContain('agent_id');
    expect(migrationIds).toEqual([
      '0.2.0_to_0.3.0_v1',
      '0.3.0_media_derivatives_v1',
      '0.3.2_to_0.4.0_agent_runtime_v1',
    ]);
    expect(store.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%_v1'").get())
      .toEqual({ count: 0 });
    expect(store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('repairs the unreleased development Backend schema into the final Runtime schema', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-runtime-repair-'));
    const databasePath = path.join(dir, 'canvas.sqlite');
    let store = new CanvasStore(databasePath, { createConversationHandle: testConversationHandleFactory });
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const reservation = store.prepareSend('user-a', {
      branchId: branch.id,
      userInput: 'repair me',
      attachments: [],
    });
    const interaction = store.acknowledgeSend(
      'user-a',
      reservation.id,
      'run-repair',
      [],
      runtimeHandle('openclaw', { runId: 'run-repair' }),
    );
    const owned = store.getOwnedInteraction('user-a', interaction.id)!;
    store.recordRuntimeEvent({
      eventKey: 'repair:event',
      runtimeId: 'openclaw',
      conversationRef: owned.conversationRef || null,
      turnRef: owned.turnRef || null,
      event: {
        runtimeId: 'openclaw',
        eventId: 'repair:event',
        type: 'turn.completed',
        conversationRef: owned.conversationRef || undefined,
        turnRef: owned.turnRef || undefined,
        createdAt: 100,
      },
      createdAt: 100,
    });
    store.close();

    const development = new DatabaseSync(databasePath);
    development.exec(`
      DROP TRIGGER IF EXISTS canvas_update_change_v2;
      DROP INDEX IF EXISTS runtime_event_pending_turn;
      DROP INDEX IF EXISTS runtime_event_pending_conversation;
      ALTER TABLE canvases RENAME COLUMN runtime_id TO backend_id;
      ALTER TABLE interactions RENAME COLUMN runtime_turn_id TO backend_turn_id;
      ALTER TABLE send_reservations RENAME COLUMN runtime_id TO backend_id;
      ALTER TABLE send_reservations RENAME COLUMN runtime_turn_id TO backend_turn_id;
      ALTER TABLE interaction_artifacts RENAME COLUMN runtime_artifact_id TO backend_artifact_id;
      ALTER TABLE interaction_artifacts RENAME COLUMN runtime_artifact_ref_json TO backend_artifact_ref_json;
      ALTER TABLE interaction_approvals RENAME COLUMN runtime_id TO backend_id;
      ALTER TABLE runtime_event_inbox RENAME TO backend_event_inbox;
      ALTER TABLE backend_event_inbox RENAME COLUMN runtime_id TO backend_id;
      CREATE INDEX backend_event_pending_turn
        ON backend_event_inbox(backend_id, turn_ref_json, processed_at);
      CREATE INDEX backend_event_pending_conversation
        ON backend_event_inbox(backend_id, conversation_ref_json, processed_at);
      UPDATE branches SET conversation_ref_json = replace(conversation_ref_json, '"runtimeId":', '"backendId":');
      UPDATE branches SET observed_conversation_ref_json = replace(observed_conversation_ref_json, '"runtimeId":', '"backendId":')
        WHERE observed_conversation_ref_json IS NOT NULL;
      UPDATE interactions SET turn_ref_json = replace(turn_ref_json, '"runtimeId":', '"backendId":')
        WHERE turn_ref_json IS NOT NULL;
      UPDATE interactions SET execution_metadata_json = replace(
        replace(execution_metadata_json, '"runtimeId":', '"backendId":'),
        '"source":"agent-runtime"', '"source":"agent-backend"'
      );
      UPDATE send_reservations SET conversation_ref_json = replace(conversation_ref_json, '"runtimeId":', '"backendId":');
      UPDATE send_reservations SET dispatch_recovery_ref_json = replace(dispatch_recovery_ref_json, '"runtimeId":', '"backendId":')
        WHERE dispatch_recovery_ref_json IS NOT NULL;
      UPDATE backend_event_inbox SET
        conversation_ref_json = replace(conversation_ref_json, '"runtimeId":', '"backendId":'),
        turn_ref_json = replace(turn_ref_json, '"runtimeId":', '"backendId":'),
        payload_json = replace(payload_json, '"runtimeId":', '"backendId":');
      DELETE FROM schema_migrations WHERE id = '0.3.2_to_0.4.0_agent_runtime_v1';
      INSERT OR IGNORE INTO schema_migrations(id, applied_at, app_version)
        VALUES ('0.3.0_media_derivatives_v1', 1, '0.3.2');
      INSERT INTO schema_migrations(id, applied_at, app_version)
        VALUES ('0.3.2_to_0.4.0_agent_backend_v1', 1, '0.4.0');
    `);
    development.close();

    store = new CanvasStore(databasePath, { createConversationHandle: testConversationHandleFactory });
    expect(store.getOwnedInteraction('user-a', interaction.id)).toMatchObject({
      runtimeId: 'openclaw',
      turnRef: { runtimeId: 'openclaw', opaque: { runId: 'run-repair' } },
      conversationRef: { runtimeId: 'openclaw' },
    });
    store.close();

    const verified = new DatabaseSync(databasePath);
    const columnNames = (table: string) => (verified.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
      .map(({ name }) => name);
    expect(columnNames('canvases')).toContain('runtime_id');
    expect(columnNames('canvases')).not.toContain('backend_id');
    expect(columnNames('interactions')).toContain('runtime_turn_id');
    expect(columnNames('interaction_artifacts')).toContain('runtime_artifact_ref_json');
    expect(verified.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'backend_event_inbox'").get())
      .toBeUndefined();
    expect(verified.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_event_inbox'").get())
      .toBeTruthy();
    expect((verified.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as Array<{ id: string }>).map(({ id }) => id))
      .toEqual([
        '0.2.0_to_0.3.0_v1',
        '0.3.0_media_derivatives_v1',
        '0.3.2_to_0.4.0_agent_runtime_v1',
      ]);
    expect(verified.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(verified.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    verified.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('deterministically migrates an exact v0.2.0 database without Gateway access', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-v020-canvas-'));
    const databasePath = path.join(dir, 'canvas.sqlite');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(readFileSync(new URL('../../fixtures/canvas-v0.2.0.sql', import.meta.url), 'utf-8'));
    legacy.exec(`
      CREATE TABLE gateway_signal_inbox (
        event_key TEXT PRIMARY KEY,
        run_id TEXT,
        session_key TEXT,
        event TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        processed_at INTEGER
      );
      INSERT INTO canvas_users
        (id, display_name, token_hash, token_version, status, created_at, updated_at)
        VALUES ('user-a', 'User A', NULL, 1, 'unmanaged', 1, 1);
      INSERT INTO canvases VALUES ('canvas-1', 'user-a', 'Legacy', 'main', 1, 1);
      INSERT INTO branches
        (id, canvas_id, kind, session_key, session_state, head_interaction_id, created_at, updated_at)
        VALUES ('branch-1', 'canvas-1', 'root', 'agent:main:canvas:branch-1', 'active', 'streaming', 1, 50);
      INSERT INTO gateway_signal_inbox
        (event_key, run_id, session_key, event, payload_json, created_at, processed_at)
        VALUES ('chat:legacy-terminal', 'run-text', 'agent:main:canvas:branch-1', 'chat',
          '{"state":"final","message":"done"}', 12, NULL);
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

    const store = new CanvasStore(databasePath, { createConversationHandle: testConversationHandleFactory });
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
    expect(store.getGraph('user-a', 'canvas-1')?.branches).toEqual([
      expect.objectContaining({ id: 'branch-1', creationMode: 'composer' }),
    ]);
    expect(store.getCanvas('user-a', 'canvas-1')).toMatchObject({ agentMutable: false });
    expect(store.db.prepare('SELECT agent_locked_at FROM canvases WHERE id = ?')
      .get('canvas-1')).toMatchObject({ agent_locked_at: 50 });
    expect(store.getOwnedCanvasAttachments('user-a', 'canvas-1', ['attachment-1'])).toHaveLength(1);
    expect(store.getReservation('send-1')).toMatchObject({ dispatchState: 'ambiguous' });
    expect(store.db.prepare(`SELECT COUNT(*) AS count FROM schema_migrations
      WHERE id = '0.2.0_to_0.3.0_v1'`).get()).toMatchObject({ count: 1 });
    expect(store.db.prepare(`SELECT app_version FROM schema_migrations
      WHERE id = '0.3.2_to_0.4.0_agent_runtime_v1'`).get()).toMatchObject({
      app_version: '0.4.0',
    });
    const columnNames = (table: string) => (store.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
      .map((column) => column.name);
    expect(columnNames('canvases')).not.toContain('agent_id');
    expect(columnNames('branches')).not.toEqual(expect.arrayContaining([
      'session_key', 'session_state', 'openclaw_session_id', 'observed_session_id',
    ]));
    expect(columnNames('interactions')).not.toEqual(expect.arrayContaining([
      'run_id', 'session_metadata_json',
    ]));
    expect(columnNames('interaction_artifacts')).not.toContain('gateway_artifact_id');
    expect(store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'gateway_signal_inbox'").get())
      .toBeUndefined();
    expect(store.db.prepare('SELECT event_key FROM runtime_event_inbox').get())
      .toEqual({ event_key: 'openclaw:chat:legacy-terminal' });

    const before = store.db.prepare(`SELECT
      (SELECT COUNT(*) FROM interaction_artifacts) AS artifacts,
      (SELECT COUNT(*) FROM artifact_sync_jobs) AS jobs,
      (SELECT COUNT(*) FROM schema_migrations) AS migrations`).get();
    const reopened = new CanvasStore(databasePath, { createConversationHandle: testConversationHandleFactory });
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
    const store = new CanvasStore(databasePath, { createConversationHandle: testConversationHandleFactory });
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
    expect(store.db.prepare(`SELECT app_version FROM schema_migrations
      WHERE id = '0.3.2_to_0.4.0_agent_runtime_v1'`).get()).toMatchObject({
      app_version: '0.4.0',
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
    const reopened = new CanvasStore(databasePath, { createConversationHandle: testConversationHandleFactory });
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

    expect(branch.conversationState).toBe('draft');
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
    expect(graph.branches[0].conversationState).toBe('active');
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

  it('restores only the latest failed send for a draft Composer', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const first = store.prepareSend('user-a', {
      branchId: branch.id,
      userInput: 'first try',
      attachments: [],
    });
    store.failReservation('user-a', first.id, 'first failure');
    expect(store.getGraph('user-a', canvas.id)?.failedSends).toEqual([
      expect.objectContaining({
        id: first.id,
        userInput: 'first try',
        error: 'first failure',
      }),
    ]);

    const second = store.prepareSend('user-a', {
      branchId: branch.id,
      userInput: 'second try',
      attachments: [],
    });
    expect(store.getGraph('user-a', canvas.id)?.failedSends).toEqual([]);
    store.failReservation('user-a', second.id, 'second failure');
    expect(store.getGraph('user-a', canvas.id)?.failedSends).toEqual([
      expect.objectContaining({
        id: second.id,
        userInput: 'second try',
        error: 'second failure',
      }),
    ]);
  });

  it('resolves attachment IDs from the owner-scoped registry and records their content identity', () => {
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
      contentHash: 'f'.repeat(64),
    };
    store.recordCanvasAttachment('user-a', canvas.id, attachment);

    expect(store.getOwnedCanvasAttachments('user-a', canvas.id, [attachment.id])).toEqual([
      expect.objectContaining({
        id: attachment.id,
        name: 'source.png',
        mimeType: 'image/png',
        contentHash: 'f'.repeat(64),
      }),
    ]);
    expect(store.getOwnedCanvasAttachments('user-b', canvas.id, [attachment.id])).toEqual([]);
  });

  it('stores versioned media derivatives by Canvas and source content hash', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const derivative = store.recordCanvasMediaDerivative({
      canvasId: canvas.id,
      sourceContentHash: 'a'.repeat(64),
      purpose: 'thumbnail',
      policyVersion: 'thumbnail-v1',
      derivativeId: 'b'.repeat(40),
      mimeType: 'image/webp',
      sizeBytes: 12_345,
      width: 768,
      height: 512,
    });

    expect(store.getCanvasMediaDerivative(
      canvas.id,
      'a'.repeat(64),
      'thumbnail',
      'thumbnail-v1',
    )).toEqual(derivative);
    expect(store.getCanvasMediaDerivative(
      canvas.id,
      'a'.repeat(64),
      'delivery',
      'delivery-v1',
    )).toBeNull();
  });

  it('changes the Canvas Agent and rewrites every draft branch session key before the first interaction', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const root = store.createRootBranch('user-a', canvas.id);

    const updated = store.updateCanvasAgentBeforeFirstInteraction('user-a', canvas.id, {
      runtimeId: 'openclaw',
      profileId: 'designer',
    });

    expect(updated?.agentRef).toEqual({ runtimeId: 'openclaw', profileId: 'designer' });
    expect(store.getGraph('user-a', canvas.id)?.branches).toEqual([
      expect.objectContaining({ id: root.id, conversationId: root.id, conversationState: 'draft' }),
    ]);
  });

  it('locks the Canvas Agent as soon as a send is prepared or an interaction exists', () => {
    const store = createStore();
    const preparedCanvas = seedUser(store);
    const preparedBranch = store.createRootBranch('user-a', preparedCanvas.id);
    store.prepareSend('user-a', { branchId: preparedBranch.id, userInput: 'hello', attachments: [] });

    expect(() => store.updateCanvasAgentBeforeFirstInteraction('user-a', preparedCanvas.id, {
      runtimeId: 'openclaw', profileId: 'designer',
    })).toThrow('agent_locked');

    store.db.prepare('UPDATE canvases SET agent_locked_at = NULL WHERE id = ?').run(preparedCanvas.id);
    expect(() => store.updateCanvasAgentBeforeFirstInteraction('user-a', preparedCanvas.id, {
      runtimeId: 'openclaw', profileId: 'designer',
    })).toThrow('agent_locked');

    const activeCanvas = store.createCanvas('user-a', 'Active Canvas', {
      runtimeId: 'openclaw', profileId: 'main',
    });
    const activeBranch = store.createRootBranch('user-a', activeCanvas.id);
    const reservation = store.prepareSend('user-a', { branchId: activeBranch.id, userInput: 'hello', attachments: [] });
    store.acknowledgeSend('user-a', reservation.id, 'run-active');

    expect(() => store.updateCanvasAgentBeforeFirstInteraction('user-a', activeCanvas.id, {
      runtimeId: 'openclaw', profileId: 'designer',
    })).toThrow('agent_locked');
  });

  it('repairs missing migrated Agent locks and removes obsolete development ledger entries', () => {
    const { store, databasePath } = createStoreFixture();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const reservation = store.prepareSend('user-a', {
      branchId: branch.id,
      userInput: 'hello',
      attachments: [],
    });
    store.db.prepare('UPDATE canvases SET agent_locked_at = NULL WHERE id = ?').run(canvas.id);
    const insertMigration = store.db.prepare(`INSERT INTO schema_migrations(id, applied_at, app_version)
      VALUES (?, ?, ?)`);
    insertMigration.run('0.2.0_to_single_chain_v1', 1, '0.2.0');
    insertMigration.run('0.3.0_to_0.4.0_agent_backend_v1', 2, '0.4.0');

    const reopened = new CanvasStore(databasePath, { createConversationHandle: testConversationHandleFactory });
    cleanups.push(() => reopened.close());

    expect(reopened.getCanvas('user-a', canvas.id)).toMatchObject({ agentMutable: false });
    expect(reopened.db.prepare('SELECT agent_locked_at FROM canvases WHERE id = ?')
      .get(canvas.id)).toMatchObject({ agent_locked_at: reservation.createdAt });
    expect(reopened.db.prepare(`SELECT COUNT(*) AS count FROM schema_migrations
      WHERE id IN ('0.2.0_to_single_chain_v1', '0.3.0_to_0.4.0_agent_backend_v1')`)
      .get()).toMatchObject({ count: 0 });
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
    expect(next.conversationId).toBe(branch.conversationId);
  });

  it('recovers canonical branch context when OpenClaw replaces the session behind a stable key', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const firstReservation = store.prepareSend('user-a', { branchId: branch.id, userInput: 'one', attachments: [] });
    const first = store.acknowledgeSend('user-a', firstReservation.id, 'run-1');
    completeInteractionForTest(store, 'user-a', first.id, { status: 'completed', agentOutput: 'answer one', artifacts: [] });

    expect(observeConversationInstance(store, branch.id, 'session-1')?.conversationIntegrity).toBe('healthy');
    expect(observeConversationInstance(store, branch.id, 'session-2')?.conversationIntegrity).toBe('drifted');

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
      conversationInstanceId: 'session-2',
      observedConversationInstanceId: 'session-2',
      conversationIntegrity: 'healthy',
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

    observeConversationInstance(store, branch.id, 'session-1', 1_000);
    observeConversationInstance(store, branch.id, 'session-1', 2_000);
    expect(store.getOwnedBranchConversationLifecycle('user-a', branch.id)).toMatchObject({
      conversationStartedAt: 1_000,
      observedConversationStartedAt: 1_000,
    });

    const recovery = store.prepareSend('user-a', {
      branchId: branch.id,
      expectedHeadInteractionId: first.id,
      userInput: 'two',
      attachments: [],
      forceSessionRecovery: true,
    });
    expect(recovery.materialization).toBe('session-recovery');

    observeConversationInstance(store, branch.id, 'session-2', 3_000);
    expect(store.getOwnedReservationSessionTarget('user-a', recovery.id)).toEqual({
      branchId: branch.id,
      conversationId: branch.conversationId,
    });
    expect(store.getOwnedReservationSessionTarget('user-b', recovery.id)).toBeNull();

    store.acknowledgeSend('user-a', recovery.id, 'run-2');
    expect(store.getOwnedBranchConversationLifecycle('user-a', branch.id)).toMatchObject({
      conversationStartedAt: 3_000,
      observedConversationStartedAt: 3_000,
    });
    expect(store.getGraph('user-a', canvas.id)!.branches[0]).toMatchObject({
      conversationInstanceId: 'session-2',
      conversationIntegrity: 'healthy',
    });
  });

  it('recovers context when a previously observed OpenClaw session disappears', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const firstReservation = store.prepareSend('user-a', { branchId: branch.id, userInput: 'one', attachments: [] });
    const first = store.acknowledgeSend('user-a', firstReservation.id, 'run-1');
    completeInteractionForTest(store, 'user-a', first.id, { status: 'completed', agentOutput: 'answer one', artifacts: [] });
    observeConversationInstance(store, branch.id, 'session-1');

    expect(store.markBranchConversationMissing(branch.id)?.conversationIntegrity).toBe('drifted');
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
      conversationInstanceId: null,
      observedConversationInstanceId: null,
      conversationIntegrity: 'unknown',
    });
  });

  it('allows fork from the completed previous head while its accepted continuation is running', () => {
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
    expect(second.executionState).toBe('running');

    const fork = store.forkInteraction('user-a', first.id);
    const forkReservation = store.prepareSend('user-a', { branchId: fork.id, userInput: 'alternative', attachments: [] });
    expect(forkReservation.materialization).toBe('canonical-replay');
    expect(forkReservation.outgoingMessage).toContain('answer one');
    expect(forkReservation.outgoingMessage).not.toContain('answer two');
    expect(forkReservation.bootstrapResources).toHaveLength(2);
    expect(forkReservation.bootstrapResources.map((resource) => resource.source)).toEqual(['user_attachment', 'agent_artifact']);
    expect(forkReservation.bootstrapResources.map((resource) => resource.replayRef)).toEqual(['F001', 'F002']);
    expect(forkReservation.outgoingMessage).toContain('User attachments: F001 — source.png');
    expect(forkReservation.outgoingMessage).toContain('Agent artifacts: F002 — result.png');
    expect(forkReservation.outgoingMessage).not.toContain('/api/canvas/');
    expect(forkReservation.outgoingMessage).not.toContain('canvas-context-resources');

    expect(store.markReservationAwaitingMedia(forkReservation.id)?.dispatchState).toBe('awaiting_media');
    expect(store.listDispatchableReservations().map((reservation) => reservation.id))
      .toContain(forkReservation.id);
  });

  it('keeps repeated historical file references while preparing one physical replay attachment', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const root = store.createRootBranch('user-a', canvas.id);
    const contentId = 'a'.repeat(40);
    const firstReservation = store.prepareSend('user-a', {
      branchId: root.id,
      userInput: 'create',
      attachments: [],
    });
    const first = store.acknowledgeSend('user-a', firstReservation.id, 'run-1');
    completeInteractionForTest(store, 'user-a', first.id, {
      status: 'completed',
      agentOutput: 'created',
      artifacts: [{
        id: contentId,
        name: 'created.png',
        mimeType: 'image/png',
        sizeBytes: 100,
        uri: `/api/canvas/artifacts/${canvas.id}/${first.id}/${contentId}`,
        storage: 'canvas',
        available: true,
      }],
    });

    const secondReservation = store.prepareSend('user-a', {
      branchId: root.id,
      expectedHeadInteractionId: first.id,
      userInput: 'edit',
      attachments: [{
        id: contentId,
        name: 'editing-source.png',
        mimeType: 'image/png',
        sizeBytes: 100,
        uri: `/api/canvas/attachments/${canvas.id}/${contentId}`,
        storage: 'canvas',
        available: true,
      }],
    });
    const second = store.acknowledgeSend('user-a', secondReservation.id, 'run-2');
    completeInteractionForTest(store, 'user-a', second.id, {
      status: 'completed',
      agentOutput: 'edited',
      artifacts: [],
    });
    const thirdReservation = store.prepareSend('user-a', {
      branchId: root.id,
      expectedHeadInteractionId: second.id,
      userInput: 'continue',
      attachments: [],
    });
    const third = store.acknowledgeSend('user-a', thirdReservation.id, 'run-3');
    completeInteractionForTest(store, 'user-a', third.id, {
      status: 'completed',
      agentOutput: 'continued',
      artifacts: [],
    });

    const fork = store.forkInteraction('user-a', second.id);
    const replay = store.prepareSend('user-a', {
      branchId: fork.id,
      userInput: 'alternative',
      attachments: [],
    });

    expect(replay.bootstrapResources).toHaveLength(1);
    expect(replay.outgoingMessage).toContain('Agent artifacts: F001 — created.png');
    expect(replay.outgoingMessage).toContain('User attachments: F001 — editing-source.png');
  });

  it('adopts a replacement physical Session after recovery completion observes it', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const initialReservation = store.prepareSend('user-a', {
      branchId: branch.id,
      userInput: 'one',
      attachments: [],
    });
    const first = store.acknowledgeSend('user-a', initialReservation.id, 'run-1');
    completeInteractionForTest(store, 'user-a', first.id, {
      status: 'completed',
      agentOutput: 'answer one',
      artifacts: [],
    });
    observeConversationInstance(store, branch.id, 'session-old');
    store.markBranchConversationMissing(branch.id);

    const recovery = store.prepareSend('user-a', {
      branchId: branch.id,
      expectedHeadInteractionId: first.id,
      userInput: 'two',
      attachments: [],
    });
    const recovering = store.acknowledgeSend('user-a', recovery.id, 'run-2');
    expect(store.getOwnedBranch('user-a', branch.id)?.conversationIntegrity).toBe('unknown');

    store.applyReconciledInteraction(recovering.id, {
      status: 'completed',
      agentOutput: 'answer two',
      artifacts: [],
      reconciliation: { phase: 'synced', artifactSync: 'synced' },
    });
    expect(store.adoptRecoveredInteractionConversation(recovering.id, 'session-new', 5_000)).toMatchObject({
      conversationInstanceId: 'session-new',
      observedConversationInstanceId: 'session-new',
      conversationIntegrity: 'healthy',
    });
    expect(store.getOwnedBranchConversationLifecycle('user-a', branch.id)).toMatchObject({
      conversationStartedAt: 5_000,
      observedConversationStartedAt: 5_000,
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

    expect(interaction.executionMetadata.bootstrapWarnings).toEqual(['source.png：读取失败']);
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
    const current = store.acknowledgeSend(
      'user-a',
      reservation.id,
      'run-1',
      [],
      runtimeHandle('openclaw', { runId: 'run-1' }),
    );

    store.updateReconciliationMetadata(current.id, { phase: 'settling', artifactSync: 'pending' });
    const updated = store.getOwnedInteraction('user-a', current.id)!;

    expect(updated.executionMetadata.materialization).toBe('lazy-root');
    expect(updated.executionMetadata.conversationId).toBe(branch.conversationId);
    expect(updated.executionMetadata.reconciliation).toMatchObject({ phase: 'settling', artifactSync: 'pending' });
    expect(store.getOwnedInteraction('user-b', current.id)).toBeNull();
  });

  it('stores the first cumulative context snapshot without later double counting or replacement', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const reservation = store.prepareSend('user-a', {
      branchId: branch.id,
      userInput: 'one',
      attachments: [],
    });
    const current = store.acknowledgeSend(
      'user-a',
      reservation.id,
      'run-1',
      [],
      runtimeHandle('openclaw', { runId: 'run-1' }),
    );
    const firstSnapshot = {
      usedTokens: 12_000,
      contextLimit: 100_000,
      conversationInstanceId: 'session-1',
      capturedAt: 123,
      source: 'agent-runtime' as const,
      runtimeId: 'openclaw',
    };

    store.applyReconciledInteraction(current.id, {
      status: 'completed',
      agentOutput: 'done',
      artifacts: [],
      contextSnapshot: firstSnapshot,
      reconciliation: { phase: 'pending', artifactSync: 'pending' },
    });
    store.applyReconciledInteraction(current.id, {
      status: 'completed',
      agentOutput: 'done',
      artifacts: [],
      contextSnapshot: {
        ...firstSnapshot,
        usedTokens: 19_000,
        capturedAt: 456,
      },
      reconciliation: { phase: 'synced', artifactSync: 'synced' },
    });

    const updated = store.getOwnedInteraction('user-a', current.id)!;
    expect(updated.contextSnapshot).toEqual(firstSnapshot);
    expect(updated.executionMetadata.contextSnapshot).toEqual(firstSnapshot);
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

  it('correlates Runtime events by durable handles and stores them idempotently', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const reservation = store.prepareSend('user-a', {
      branchId: branch.id,
      userInput: 'one',
      attachments: [],
    });
    const current = store.acknowledgeSend(
      'user-a',
      reservation.id,
      'run-1',
      [],
      runtimeHandle('openclaw', { runId: 'run-1' }),
    );
    const owned = store.getOwnedInteraction('user-a', current.id)!;
    expect(store.findInteractionByRuntimeCorrelation('openclaw', owned.turnRef || null, null)?.id)
      .toBe(current.id);
    expect(store.findInteractionByRuntimeCorrelation('openclaw', null, owned.conversationRef || null)?.id)
      .toBe(current.id);

    const event = {
      eventKey: 'chat:1',
      runtimeId: 'openclaw',
      turnRef: owned.turnRef || null,
      conversationRef: owned.conversationRef || null,
      event: {
        runtimeId: 'openclaw',
        eventId: 'chat:1',
        type: 'turn.completed' as const,
        turnRef: owned.turnRef || undefined,
        conversationRef: owned.conversationRef || undefined,
        createdAt: Date.now(),
      },
      createdAt: Date.now(),
    };
    expect(store.recordRuntimeEvent(event)).toBe(true);
    expect(store.recordRuntimeEvent(event)).toBe(false);
    expect(store.listPendingRuntimeEvents('openclaw', owned.turnRef || null, owned.conversationRef!)).toEqual([
      expect.objectContaining({ eventKey: 'chat:1', event: expect.objectContaining({ type: 'turn.completed' }) }),
    ]);
    store.markRuntimeEventProcessed('chat:1');
    expect(store.listPendingRuntimeEvents('openclaw', owned.turnRef || null, owned.conversationRef!)).toEqual([]);
  });

  it('persists protocol-neutral Runtime bindings and durable events', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const reservation = store.prepareSend('user-a', {
      branchId: branch.id,
      userInput: 'one',
      attachments: [],
    });
    expect(reservation).toMatchObject({
      runtimeId: 'openclaw',
      conversationRef: {
        runtimeId: 'openclaw',
        schemaVersion: 1,
        opaque: { sessionKey: `agent:main:canvas:${branch.id}` },
      },
    });
    const current = store.acknowledgeSend(
      'user-a',
      reservation.id,
      'run-1',
      [],
      runtimeHandle('openclaw', { runId: 'run-1' }),
    );
    const owned = store.getOwnedInteraction('user-a', current.id)!;
    expect(owned).toMatchObject({
      runtimeId: 'openclaw',
      agentProfileId: 'main',
      turnRef: { runtimeId: 'openclaw', opaque: { runId: 'run-1' } },
      conversationRef: { runtimeId: 'openclaw', opaque: { sessionKey: `agent:main:canvas:${branch.id}` } },
    });
    expect(store.findInteractionByRuntimeCorrelation(
      'openclaw',
      owned.turnRef || null,
      owned.conversationRef || null,
    )?.id).toBe(current.id);

    const event = {
      runtimeId: 'openclaw',
      eventId: 'openclaw:chat:1',
      type: 'turn.completed' as const,
      conversationRef: owned.conversationRef,
      turnRef: owned.turnRef || undefined,
      text: 'done',
      createdAt: Date.now(),
    };
    expect(store.recordRuntimeEvent({
      eventKey: event.eventId,
      runtimeId: event.runtimeId,
      conversationRef: event.conversationRef || null,
      turnRef: event.turnRef || null,
      event,
      createdAt: event.createdAt,
    })).toBe(true);
    expect(store.recordRuntimeEvent({
      eventKey: event.eventId,
      runtimeId: event.runtimeId,
      conversationRef: event.conversationRef || null,
      turnRef: event.turnRef || null,
      event,
      createdAt: event.createdAt,
    })).toBe(false);
    expect(store.listPendingRuntimeEvents(
      'openclaw',
      owned.turnRef || null,
      owned.conversationRef!,
    )).toEqual([expect.objectContaining({ eventKey: event.eventId, event })]);
    store.markRuntimeEventProcessed(event.eventId);
    expect(store.listPendingRuntimeEvents(
      'openclaw',
      owned.turnRef || null,
      owned.conversationRef!,
    )).toEqual([]);
  });

  it('persists, validates, and resolves unified Interaction approvals', () => {
    const store = createStore();
    const canvas = seedUser(store);
    const branch = store.createRootBranch('user-a', canvas.id);
    const reservation = store.prepareSend('user-a', { branchId: branch.id, userInput: 'run it', attachments: [] });
    const interaction = store.acknowledgeSend('user-a', reservation.id, 'run-approval');
    const approvalRef = {
      runtimeId: 'openclaw', schemaVersion: 1, opaque: { approvalId: 'approval-1', approvalKind: 'exec' },
    };
    const approval = store.recordInteractionApproval(interaction.id, 'openclaw', approvalRef, {
      category: 'command',
      title: 'Execute command',
      description: 'npm test',
      risk: 'high',
      permissions: [{ id: 'execute', label: 'Execute command', risk: 'high' }],
      choices: [
        { id: 'allow-once', intent: 'grant', scope: 'item', label: 'Allow once', requiresConfirmation: false },
        { id: 'allow-always', intent: 'grant', scope: 'persistent', label: 'Always allow', requiresConfirmation: true },
        { id: 'deny', intent: 'deny', scope: 'item', label: 'Deny', requiresConfirmation: false },
      ],
    });
    expect(approval).toMatchObject({ status: 'pending', runtimeId: 'openclaw' });
    expect(store.getGraph('user-a', canvas.id)?.interactions[0].approvals).toEqual([
      expect.objectContaining({ id: approval?.id, status: 'pending', title: 'Execute command' }),
    ]);
    expect(() => store.claimInteractionApproval('user-a', approval!.id, {
      choiceId: 'allow-once', grantedPermissionIds: ['unknown'],
    })).toThrow('approval_permissions_invalid');
    expect(() => store.claimInteractionApproval('user-a', approval!.id, {
      choiceId: 'allow-always', grantedPermissionIds: ['execute'],
    })).toThrow('approval_confirmation_required');
    expect(store.claimInteractionApproval('user-a', approval!.id, {
      choiceId: 'allow-once', grantedPermissionIds: ['execute'],
    })).toMatchObject({ status: 'resolving' });
    expect(store.finishInteractionApproval(approval!.id, 'accepted')).toMatchObject({
      status: 'resolved',
      resolution: { choiceId: 'allow-once', grantedPermissionIds: ['execute'] },
    });
  });
});
