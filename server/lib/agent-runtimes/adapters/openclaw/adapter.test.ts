import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeHandle } from '../../contract.js';

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
import { openClawAgentRuntime } from './adapter.js';

const conversationRef = runtimeHandle('openclaw', { sessionKey: 'agent:main:canvas:branch-1' });
const profile = { runtimeId: 'openclaw', profileId: 'main' };

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.dispatch.mockReset();
  mocks.supports.mockReset();
  mocks.supports.mockReturnValue(true);
});

describe('OpenClawAgentRuntime contract', () => {
  it('reports unknown image-generation support and idempotent dispatch semantics', async () => {
    await expect(openClawAgentRuntime.getCapabilities(profile)).resolves.toMatchObject({
      output: { imageGeneration: 'unknown' },
      reliability: { idempotentDispatch: true, inspectAfterUnknownOutcome: false },
    });
    await expect(openClawAgentRuntime.reconcileDispatch({
      profile,
      conversationRef,
      recoveryRef: null,
      idempotencyKey: 'send-unknown',
      message: 'hello',
      createdAt: 1,
    })).resolves.toMatchObject({ outcome: 'unknown', error: { kind: 'unsupported' } });
  });

  it('projects the Agent catalog into stable profiles', async () => {
    mocks.rpc.mockResolvedValue({
      defaultId: 'main',
      agents: [{ id: 'main', name: 'Main Agent', identity: { name: 'Assistant' } }],
    });
    await expect(openClawAgentRuntime.listAgentProfiles({ ownerId: 'owner-a' })).resolves.toMatchObject({
      defaultProfileId: 'main',
      profiles: [{ runtimeId: 'openclaw', profileId: 'main', displayName: 'Assistant' }],
    });
  });

  it('normalizes accepted, rejected, and unknown dispatch outcomes', async () => {
    mocks.dispatch.mockResolvedValueOnce({ runId: 'run-1' });
    await expect(openClawAgentRuntime.dispatchTurn({
      profile,
      conversationRef,
      message: 'hello',
      attachments: [],
      idempotencyKey: 'send-1',
    })).resolves.toMatchObject({
      outcome: 'accepted',
      turnRef: { runtimeId: 'openclaw', opaque: { runId: 'run-1' } },
    });

    mocks.dispatch.mockRejectedValueOnce(new GatewayDispatchError('rejected', 'invalid'));
    await expect(openClawAgentRuntime.dispatchTurn({
      profile, conversationRef, message: 'hello', attachments: [], idempotencyKey: 'send-2',
    })).resolves.toMatchObject({ outcome: 'rejected', error: { kind: 'rejected' } });

    mocks.dispatch.mockRejectedValueOnce(new GatewayDispatchError('outcome_unknown', 'connection lost'));
    await expect(openClawAgentRuntime.dispatchTurn({
      profile, conversationRef, message: 'hello', attachments: [], idempotencyKey: 'send-3',
    })).resolves.toMatchObject({ outcome: 'unknown', error: { kind: 'unknown_outcome' } });
  });

  it('resolves exec and plugin approvals through the matching native RPC', async () => {
    mocks.rpc.mockResolvedValue({ ok: true });
    await openClawAgentRuntime.resolveApproval({
      approvalRef: runtimeHandle('openclaw', { approvalId: 'exec-1', approvalKind: 'exec' }),
      resolution: { choiceId: 'allow-once' },
    });
    await openClawAgentRuntime.resolveApproval({
      approvalRef: runtimeHandle('openclaw', { approvalId: 'plugin-1', approvalKind: 'plugin' }),
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

    const snapshot = await openClawAgentRuntime.readTurn({
      profile,
      conversationRef,
      turnRef: runtimeHandle('openclaw', { runId: 'run-1' }),
      userInput: 'make an image',
      createdAt: 1,
    });

    expect(snapshot.artifacts).toHaveLength(1);
    expect(snapshot.artifacts[0]).toMatchObject({
      name: 'result.png',
      runtimeArtifactRef: { opaque: { kind: 'native', artifactId: 'artifact-1' } },
    });
  });

  it('rejects handles owned by another Runtime', async () => {
    await expect(openClawAgentRuntime.dispatchTurn({
      profile,
      conversationRef: runtimeHandle('other', { conversationId: '1' }),
      message: 'hello',
      attachments: [],
      idempotencyKey: 'send-4',
    })).rejects.toMatchObject({ kind: 'validation' });
  });
});
