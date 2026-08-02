import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnedInteractionRecord } from './canvas-db.js';

const gatewayRpcCall = vi.fn();
const supported = new Set<string>();

vi.mock('./agent-backends/adapters/openclaw/gateway-rpc.js', () => ({
  gatewayRpcCall,
  gatewaySupports: (method: string) => supported.has(method),
  GatewayRpcError: class GatewayRpcError extends Error {
    code?: string;
    constructor(message: string, details?: Record<string, unknown>) {
      super(message);
      this.code = typeof details?.code === 'string' ? details.code : undefined;
    }
  },
  getGatewaySharedHttpAuthToken: () => 'shared-token',
}));
vi.mock('./canvas-artifact-store.js', () => ({
  CANVAS_ARTIFACT_MAX_BYTES: 25 * 1024 * 1024,
  cleanupOrphanCanvasArtifacts: vi.fn(),
  materializeCanvasArtifacts: vi.fn(async (_interaction, artifacts) => ({
    artifacts,
    complete: true,
    warnings: [],
  })),
}));
vi.mock('./canvas-db.js', () => ({
  getCanvasStore: () => ({ observeBranchConversation: vi.fn() }),
}));
vi.mock('./config.js', () => ({
  config: { gatewayUrl: 'http://127.0.0.1:18789', gatewayToken: 'bootstrap-token' },
}));

function interaction(): OwnedInteractionRecord {
  return {
    id: 'interaction-1',
    branchId: 'branch-1',
    parentInteractionId: null,
    backendTurnId: 'run-1',
    turnRef: { backendId: 'openclaw', schemaVersion: 1, opaque: { runId: 'run-1' } },
    userInput: 'create image',
    agentOutput: '',
    status: 'completed',
    attachments: [],
    artifacts: [],
    approvals: [],
    executionMetadata: {},
    createdAt: 1,
    updatedAt: 1,
    ownerId: 'owner-1',
    canvasId: 'canvas-1',
    conversationId: 'agent:main:canvas:branch-1',
    backendId: 'openclaw',
    agentProfileId: 'main',
    conversationRef: {
      backendId: 'openclaw',
      schemaVersion: 1,
      opaque: { sessionKey: 'agent:main:canvas:branch-1' },
    },
    conversationInstanceId: null,
    observedConversationInstanceId: null,
    conversationIntegrity: 'unknown',
  };
}

describe('Gateway-native Canvas Artifact reconciliation', () => {
  beforeEach(() => {
    gatewayRpcCall.mockReset();
    supported.clear();
  });

  it('returns native Artifact handles for generic Canvas materialization', async () => {
    supported.add('artifacts.list');
    supported.add('artifacts.download');
    gatewayRpcCall.mockImplementation(async (method: string) => {
      if (method === 'sessions.get') {
        return {
          messages: [
            { role: 'user', content: 'create image' },
            { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
          ],
        };
      }
      if (method === 'artifacts.list') {
        return { artifacts: [{ id: 'artifact_native', title: 'result.png', mimeType: 'image/png', sizeBytes: 3 }] };
      }
      if (method === 'artifacts.download') {
        return { artifact: { id: 'artifact_native', mimeType: 'image/png' }, encoding: 'base64', data: 'AQID' };
      }
      return {};
    });
    const { reconcileTranscriptSnapshot } = await import('./canvas-reconciler.js');
    const snapshot = await reconcileTranscriptSnapshot(interaction());

    expect(snapshot.agentOutput).toBe('done');
    expect(snapshot.artifactPersistenceComplete).toBe(true);
    expect(snapshot.artifacts).toEqual([
      expect.objectContaining({
        backendArtifactRef: expect.objectContaining({
          backendId: 'openclaw',
          opaque: expect.objectContaining({ artifactId: 'artifact_native', kind: 'native' }),
        }),
      }),
    ]);
    expect(gatewayRpcCall).not.toHaveBeenCalledWith('artifacts.download', expect.anything(), expect.anything());
  });

  it('keeps text but marks Artifact sync degraded when native methods are absent', async () => {
    gatewayRpcCall.mockResolvedValue({
      messages: [
        { role: 'user', content: 'create image' },
        { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      ],
    });
    const { reconcileTranscriptSnapshot } = await import('./canvas-reconciler.js');
    const snapshot = await reconcileTranscriptSnapshot(interaction());

    expect(snapshot.agentOutput).toBe('done');
    expect(snapshot.artifactPersistenceComplete).toBe(false);
    expect(snapshot.artifactWarnings?.[0]).toContain('artifacts.list/download');
  });

  it('falls back to the Interaction transcript when a completed run no longer resolves to a Session', async () => {
    supported.add('artifacts.list');
    supported.add('artifacts.download');
    gatewayRpcCall.mockImplementation(async (method: string) => {
      if (method === 'sessions.get') {
        return {
          messages: [
            { role: 'user', content: 'create image' },
            {
              role: 'assistant',
              content: [
                { type: 'text', text: 'done' },
                {
                  type: 'image',
                  url: '/api/chat/media/outgoing/agent%3Amain%3Acanvas%3Abranch-1/image-id/full',
                  alt: 'result.png',
                  mimeType: 'image/png',
                },
              ],
            },
          ],
        };
      }
      if (method === 'artifacts.list') {
        const error = new Error('no session found for artifact query') as Error & { code?: string };
        error.code = 'artifact_scope_not_found';
        throw error;
      }
      return {};
    });

    const { reconcileTranscriptSnapshot } = await import('./canvas-reconciler.js');
    const snapshot = await reconcileTranscriptSnapshot(interaction());

    expect(snapshot.artifactPersistenceComplete).toBe(true);
    expect(snapshot.artifactWarnings).toEqual([]);
    expect(snapshot.artifacts).toEqual([
      expect.objectContaining({
        name: 'result.png',
        uri: '/api/chat/media/outgoing/agent%3Amain%3Acanvas%3Abranch-1/image-id/full',
      }),
    ]);
    expect(gatewayRpcCall).not.toHaveBeenCalledWith(
      'artifacts.list',
      expect.objectContaining({ conversationId: expect.any(String) }),
      expect.any(Number),
    );
  });
});
