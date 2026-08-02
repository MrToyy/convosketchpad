import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backendHandle } from '../../contract.js';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  dispatch: vi.fn(),
  supports: vi.fn(() => true),
}));

vi.mock('./gateway-rpc.js', () => {
  class GatewayDispatchError extends Error {
    kind: 'not_sent' | 'outcome_unknown' | 'rejected';
    constructor(kind: 'not_sent' | 'outcome_unknown' | 'rejected', message: string) {
      super(message);
      this.kind = kind;
    }
  }
  return {
    GatewayDispatchError,
    GatewayRpcError: class GatewayRpcError extends Error {},
    gatewayDispatchCall: mocks.dispatch,
    gatewayRpcCall: mocks.rpc,
    gatewaySupports: mocks.supports,
    getGatewayRuntimeStatus: () => ({
      state: 'connected',
      gatewayRestartSupported: true,
      methods: ['chat.send', 'exec.approval.resolve', 'plugin.approval.resolve'],
      maxPayload: 1_000_000,
    }),
    subscribeGatewayEvents: () => () => undefined,
    subscribeGatewayStatus: () => () => undefined,
    closeGatewayRpc: vi.fn(),
    getGatewaySharedHttpAuthToken: () => 'token',
  };
});

vi.mock('./openclaw-session-policy.js', () => ({
  getCanvasSessionResetPolicy: vi.fn(async () => ({ available: true, policy: null })),
  sessionWillResetBeforeSend: vi.fn(() => false),
}));

import { GatewayDispatchError } from './gateway-rpc.js';
import { openClawAgentBackend } from './adapter.js';

const conversationRef = backendHandle('openclaw', { sessionKey: 'agent:main:canvas:branch-1' });
const profile = { backendId: 'openclaw', profileId: 'main' };

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.dispatch.mockReset();
  mocks.supports.mockReset();
  mocks.supports.mockReturnValue(true);
});

describe('OpenClawAgentBackend contract', () => {
  it('projects the Agent catalog into stable profiles', async () => {
    mocks.rpc.mockResolvedValue({
      defaultId: 'main',
      agents: [{ id: 'main', name: 'Main Agent', identity: { name: 'Assistant' } }],
    });
    await expect(openClawAgentBackend.listAgentProfiles({ ownerId: 'owner-a' })).resolves.toMatchObject({
      defaultProfileId: 'main',
      profiles: [{ backendId: 'openclaw', profileId: 'main', displayName: 'Assistant' }],
    });
  });

  it('normalizes accepted, rejected, and unknown dispatch outcomes', async () => {
    mocks.dispatch.mockResolvedValueOnce({ runId: 'run-1' });
    await expect(openClawAgentBackend.dispatchTurn({
      profile,
      conversationRef,
      message: 'hello',
      attachments: [],
      idempotencyKey: 'send-1',
    })).resolves.toMatchObject({
      outcome: 'accepted',
      turnRef: { backendId: 'openclaw', opaque: { runId: 'run-1' } },
    });

    mocks.dispatch.mockRejectedValueOnce(new GatewayDispatchError('rejected', 'invalid'));
    await expect(openClawAgentBackend.dispatchTurn({
      profile, conversationRef, message: 'hello', attachments: [], idempotencyKey: 'send-2',
    })).resolves.toMatchObject({ outcome: 'rejected', error: { kind: 'rejected' } });

    mocks.dispatch.mockRejectedValueOnce(new GatewayDispatchError('outcome_unknown', 'connection lost'));
    await expect(openClawAgentBackend.dispatchTurn({
      profile, conversationRef, message: 'hello', attachments: [], idempotencyKey: 'send-3',
    })).resolves.toMatchObject({ outcome: 'unknown', error: { kind: 'unknown_outcome' } });
  });

  it('resolves exec and plugin approvals through the matching native RPC', async () => {
    mocks.rpc.mockResolvedValue({ ok: true });
    await openClawAgentBackend.resolveApproval({
      approvalRef: backendHandle('openclaw', { approvalId: 'exec-1', approvalKind: 'exec' }),
      resolution: { choiceId: 'allow-once' },
    });
    await openClawAgentBackend.resolveApproval({
      approvalRef: backendHandle('openclaw', { approvalId: 'plugin-1', approvalKind: 'plugin' }),
      resolution: { choiceId: 'deny' },
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'exec.approval.resolve', {
      id: 'exec-1', decision: 'allow-once',
    }, 15_000);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'plugin.approval.resolve', {
      id: 'plugin-1', decision: 'deny',
    }, 15_000);
  });

  it('deduplicates a native Artifact also found in the turn transcript', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        sessionId: 'session-1',
        messages: [{
          role: 'assistant',
          content: [{ type: 'image', url: '/tmp/result.png', name: 'result.png', mimeType: 'image/png' }],
        }],
      })
      .mockResolvedValueOnce({
        artifacts: [{ id: 'artifact-1', title: 'result.png', mimeType: 'image/png' }],
      });

    const snapshot = await openClawAgentBackend.readTurn({
      profile,
      conversationRef,
      turnRef: backendHandle('openclaw', { runId: 'run-1' }),
      userInput: 'make an image',
      createdAt: 1,
    });

    expect(snapshot.artifacts).toHaveLength(1);
    expect(snapshot.artifacts[0]).toMatchObject({
      name: 'result.png',
      backendArtifactRef: { opaque: { kind: 'native', artifactId: 'artifact-1' } },
    });
  });

  it('rejects handles owned by another Backend', async () => {
    await expect(openClawAgentBackend.dispatchTurn({
      profile,
      conversationRef: backendHandle('other', { conversationId: '1' }),
      message: 'hello',
      attachments: [],
      idempotencyKey: 'send-4',
    })).rejects.toMatchObject({ kind: 'validation' });
  });
});
