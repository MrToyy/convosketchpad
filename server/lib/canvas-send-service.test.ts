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
});
