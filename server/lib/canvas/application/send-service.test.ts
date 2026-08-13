import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasStore } from '../persistence/canvas-store.js';
import { testConversationHandleFactory } from '../../fixtures/test-conversation-handle.js';
import {
  CanvasSendApplicationError,
  CanvasSendService,
} from './send-service.js';

const cleanups: Array<() => void> = [];

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-send-service-'));
  const store = new CanvasStore(path.join(dir, 'canvas.sqlite'), {
    createConversationHandle: testConversationHandleFactory,
  });
  store.ensureUser('owner-a', 'Owner A');
  const canvas = store.createCanvas('owner-a', 'Canvas', { runtimeId: 'openclaw', profileId: 'main' });
  const branch = store.createRootBranch('owner-a', canvas.id);
  cleanups.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, canvas, branch };
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe('CanvasSendService', () => {
  it('prepares and returns an immediate acknowledged interaction', async () => {
    const { store, branch } = fixture();
    const service = new CanvasSendService({
      store,
      dispatch: vi.fn(async (reservationId: string) =>
        store.acknowledgeSend('owner-a', reservationId, 'run-1')),
    });
    const result = await service.submit('owner-a', {
      branchId: branch.id,
      agentRef: { runtimeId: 'openclaw', profileId: 'main' },
      userInput: 'hello',
      attachmentIds: [],
    });
    expect(result).toMatchObject({
      kind: 'interaction',
      interaction: {
        branchId: branch.id,
        userInput: 'hello',
        runtimeTurnId: 'run-1',
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
      dispatch: vi.fn(async (reservationId: string) => store.getReservation(reservationId)!),
    });
    const result = await service.submit('owner-a', {
      branchId: branch.id,
      agentRef: { runtimeId: 'openclaw', profileId: 'main' },
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

  it('maps protocol-neutral unsupported text input to service unavailable', async () => {
    const { store, branch } = fixture();
    const service = new CanvasSendService({
      store,
      dispatch: vi.fn(async (reservationId: string) => {
        store.failReservationById(reservationId, 'runtime_text_input_unsupported');
        return store.getReservation(reservationId)!;
      }),
    });

    await expect(service.submit('owner-a', {
      branchId: branch.id,
      agentRef: { runtimeId: 'openclaw', profileId: 'main' },
      userInput: 'hello',
      attachmentIds: [],
    })).resolves.toMatchObject({
      kind: 'rejected',
      error: 'runtime_text_input_unsupported',
      status: 503,
    });
  });

  it('keeps ownership and attachment validation in the application boundary', async () => {
    const { store, branch } = fixture();
    const service = new CanvasSendService({ store });
    await expect(service.submit('owner-a', {
      branchId: branch.id,
      agentRef: { runtimeId: 'openclaw', profileId: 'main' },
      userInput: 'hello',
      attachmentIds: ['a'.repeat(40)],
    })).rejects.toBeInstanceOf(CanvasSendApplicationError);
  });

  it('freezes a changed Composer Agent into an agent-handoff operation', async () => {
    const { store, branch } = fixture();
    const initial = store.prepareSend('owner-a', {
      branchId: branch.id,
      agentRef: { runtimeId: 'openclaw', profileId: 'main' },
      userInput: 'research',
      attachments: [],
    });
    const source = store.acknowledgeSend('owner-a', initial.id, 'run-1');
    store.applyReconciledInteraction(source.id, {
      status: 'completed',
      agentOutput: 'findings',
      artifacts: [],
      reconciliation: { phase: 'synced', artifactSync: 'synced' },
    });
    const dispatch = vi.fn(async (reservationId: string) => store.getReservation(reservationId)!);
    const service = new CanvasSendService({ store, dispatch });

    const result = await service.submit('owner-a', {
      branchId: branch.id,
      expectedHeadInteractionId: source.id,
      agentRef: { runtimeId: 'codex', profileId: 'default' },
      userInput: 'write the final script',
      attachmentIds: [],
    });

    expect(result).toMatchObject({
      kind: 'operation',
      operation: {
        materialization: 'agent-handoff',
        runtimeId: 'codex',
        agentProfileId: 'default',
      },
    });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(store.getOwnedBranch('owner-a', branch.id)?.activeAgentRef)
      .toEqual({ runtimeId: 'openclaw', profileId: 'main' });
  });

});
