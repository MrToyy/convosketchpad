import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasStore } from './canvas-db.js';
import {
  CanvasSendApplicationError,
  CanvasSendService,
} from './canvas-send-service.js';
import type { OpenClawCanvasPort } from './openclaw-canvas.js';

const cleanups: Array<() => void> = [];

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-send-service-'));
  const store = new CanvasStore(path.join(dir, 'canvas.sqlite'));
  store.ensureUser('owner-a', 'Owner A');
  const canvas = store.createCanvas('owner-a', 'Canvas', 'main');
  const branch = store.createRootBranch('owner-a', canvas.id);
  cleanups.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, canvas, branch };
}

function gateway(): OpenClawCanvasPort {
  return {
    listAgents: vi.fn(),
    inspectSession: vi.fn(async () => ({ listed: true, sessionId: null })),
    getResetPolicy: vi.fn(async () => ({
      available: true,
      policy: { mode: 'daily', atHour: 4, idleMinutes: null },
    })),
    send: vi.fn(),
    supports: vi.fn(() => true),
    runtimeStatus: vi.fn(() => ({
      state: 'connected',
      gatewayRestartSupported: true,
      methods: ['chat.send'],
    })),
  };
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe('CanvasSendService', () => {
  it('prepares and returns an immediate acknowledged interaction', async () => {
    const { store, branch } = fixture();
    const service = new CanvasSendService({
      store,
      gateway: gateway(),
      dispatch: vi.fn(async (reservationId: string) =>
        store.acknowledgeSend('owner-a', reservationId, 'run-1')),
    });
    const result = await service.submit('owner-a', {
      branchId: branch.id,
      expectedAgentId: 'main',
      userInput: 'hello',
      attachmentIds: [],
    });
    expect(result).toMatchObject({
      kind: 'interaction',
      interaction: {
        branchId: branch.id,
        userInput: 'hello',
        runId: 'run-1',
      },
    });
    expect(store.getOwnedBranch('owner-a', branch.id)?.headInteractionId).toBe(
      result.kind === 'interaction' ? result.interaction.id : null,
    );
  });

  it('returns a durable operation without exposing dispatch decisions to the route', async () => {
    const { store, branch } = fixture();
    const service = new CanvasSendService({
      store,
      gateway: gateway(),
      dispatch: vi.fn(async (reservationId: string) => store.getReservation(reservationId)!),
    });
    const result = await service.submit('owner-a', {
      branchId: branch.id,
      expectedAgentId: 'main',
      userInput: 'queued',
      attachmentIds: [],
    });
    expect(result).toMatchObject({
      kind: 'operation',
      operation: {
        branchId: branch.id,
        status: 'prepared',
        dispatchState: 'reserved',
      },
    });
  });

  it('keeps ownership, Agent, and attachment validation in the application boundary', async () => {
    const { store, branch } = fixture();
    const service = new CanvasSendService({ store, gateway: gateway() });
    await expect(service.submit('owner-a', {
      branchId: branch.id,
      expectedAgentId: 'other',
      userInput: 'hello',
      attachmentIds: [],
    })).rejects.toMatchObject({
      code: 'agent_changed',
      status: 409,
    });
    await expect(service.submit('owner-a', {
      branchId: branch.id,
      expectedAgentId: 'main',
      userInput: 'hello',
      attachmentIds: ['a'.repeat(40)],
    })).rejects.toBeInstanceOf(CanvasSendApplicationError);
  });

  it('resubmits a first Interaction as an ordinary direct-submit root branch', async () => {
    const { store, canvas, branch } = fixture();
    const initial = store.prepareSend('owner-a', {
      branchId: branch.id,
      userInput: 'try this',
      attachments: [],
    });
    const source = store.acknowledgeSend('owner-a', initial.id, 'run-source');
    const manualRoot = store.createRootBranch('owner-a', canvas.id);
    const service = new CanvasSendService({
      store,
      gateway: gateway(),
      dispatch: vi.fn(async (reservationId: string) => store.getReservation(reservationId)!),
    });

    const result = await service.resubmit('owner-a', {
      interactionId: source.id,
      expectedAgentId: 'main',
    });

    expect(result).toMatchObject({
      kind: 'operation',
      operation: {
        userInput: 'try this',
        materialization: 'lazy-root',
      },
    });
    const operation = result.kind === 'operation' ? result.operation : null;
    const resubmittedBranch = operation
      ? store.getOwnedBranch('owner-a', operation.branchId)
      : null;
    expect(resubmittedBranch).toMatchObject({
      kind: 'root',
      creationMode: 'direct-submit',
      parentBranchId: null,
      forkedFromInteractionId: null,
    });
    expect(manualRoot.creationMode).toBe('composer');
    expect(store.getOwnedInteraction('owner-a', source.id)?.executionState).toBe('running');
  });

  it('resubmits from the parent snapshot without including the source output', async () => {
    const { store, canvas, branch } = fixture();
    const firstReservation = store.prepareSend('owner-a', {
      branchId: branch.id,
      userInput: 'one',
      attachments: [],
    });
    const first = store.acknowledgeSend('owner-a', firstReservation.id, 'run-1');
    store.applyReconciledInteraction(first.id, {
      status: 'completed',
      agentOutput: 'answer one',
      artifacts: [],
      artifactSyncState: 'synced',
      artifactObservationPending: false,
      error: null,
      reconciliation: { phase: 'synced', artifactSync: 'synced' },
    });
    const attachmentId = 'a'.repeat(40);
    store.recordCanvasAttachment('owner-a', canvas.id, {
      id: attachmentId,
      name: 'source.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      uri: `/api/canvas/attachments/${canvas.id}/${attachmentId}`,
      storage: 'canvas',
      available: true,
    });
    const secondReservation = store.prepareSend('owner-a', {
      branchId: branch.id,
      expectedHeadInteractionId: first.id,
      userInput: 'two',
      attachments: store.getOwnedCanvasAttachments('owner-a', canvas.id, [attachmentId]),
    });
    const source = store.acknowledgeSend('owner-a', secondReservation.id, 'run-2');
    const service = new CanvasSendService({
      store,
      gateway: gateway(),
      dispatch: vi.fn(async (reservationId: string) => store.getReservation(reservationId)!),
    });

    const result = await service.resubmit('owner-a', {
      interactionId: source.id,
      expectedAgentId: 'main',
    });
    expect(result).toMatchObject({
      kind: 'operation',
      operation: {
        userInput: 'two',
        materialization: 'canonical-replay',
        attachments: [expect.objectContaining({ id: attachmentId })],
      },
    });
    const operation = result.kind === 'operation' ? result.operation : null;
    expect(operation?.outgoingMessage).toContain('answer one');
    expect(operation?.outgoingMessage).not.toContain('run-2');
    expect(operation && store.getOwnedBranch('owner-a', operation.branchId)).toMatchObject({
      kind: 'fork',
      creationMode: 'direct-submit',
      parentBranchId: branch.id,
      forkedFromInteractionId: first.id,
    });
  });

  it('does not create a Branch when a source attachment cannot be resolved', async () => {
    const { store, canvas, branch } = fixture();
    const attachmentId = 'b'.repeat(40);
    store.recordCanvasAttachment('owner-a', canvas.id, {
      id: attachmentId,
      name: 'missing.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      storage: 'canvas',
      available: true,
    });
    const initial = store.prepareSend('owner-a', {
      branchId: branch.id,
      userInput: 'inspect',
      attachments: store.getOwnedCanvasAttachments('owner-a', canvas.id, [attachmentId]),
    });
    const source = store.acknowledgeSend('owner-a', initial.id, 'run-source');
    store.db.prepare(`DELETE FROM canvas_attachments
      WHERE canvas_id = ? AND attachment_id = ?`).run(canvas.id, attachmentId);
    const branchCount = store.getGraph('owner-a', canvas.id)?.branches.length;

    await expect(new CanvasSendService({
      store,
      gateway: gateway(),
    }).resubmit('owner-a', {
      interactionId: source.id,
      expectedAgentId: 'main',
    })).rejects.toMatchObject({
      code: 'source_attachment_unavailable',
      status: 422,
    });
    expect(store.getGraph('owner-a', canvas.id)?.branches).toHaveLength(branchCount || 0);
  });
});
