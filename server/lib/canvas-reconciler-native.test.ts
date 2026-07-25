import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnedInteractionRecord } from './canvas-db.js';

const gatewayRpcCall = vi.fn();
const supported = new Set<string>();
const persistCanvasArtifactBytes = vi.fn();

vi.mock('./gateway-rpc.js', () => ({
  gatewayRpcCall,
  gatewaySupports: (method: string) => supported.has(method),
  getGatewayHttpAuthToken: () => 'device-token',
}));
vi.mock('./canvas-artifact-store.js', () => ({
  CANVAS_ARTIFACT_MAX_BYTES: 25 * 1024 * 1024,
  cleanupOrphanCanvasArtifacts: vi.fn(),
  materializeCanvasArtifacts: vi.fn(async (_interaction, artifacts) => ({
    artifacts,
    complete: true,
    warnings: [],
  })),
  persistCanvasArtifactBytes,
}));
vi.mock('./canvas-db.js', () => ({
  getCanvasStore: () => ({ observeBranchSession: vi.fn() }),
}));
vi.mock('./config.js', () => ({
  config: { gatewayUrl: 'http://127.0.0.1:18789', gatewayToken: 'bootstrap-token' },
}));

function interaction(): OwnedInteractionRecord {
  return {
    id: 'interaction-1',
    branchId: 'branch-1',
    parentInteractionId: null,
    runId: 'run-1',
    userInput: 'create image',
    agentOutput: '',
    status: 'completed',
    attachments: [],
    artifacts: [],
    sessionMetadata: {},
    createdAt: 1,
    updatedAt: 1,
    ownerId: 'owner-1',
    canvasId: 'canvas-1',
    sessionKey: 'agent:main:canvas:branch-1',
    agentId: 'main',
    openClawSessionId: null,
    observedSessionId: null,
    sessionIntegrity: 'unknown',
  };
}

describe('Gateway-native Canvas Artifact reconciliation', () => {
  beforeEach(() => {
    gatewayRpcCall.mockReset();
    persistCanvasArtifactBytes.mockReset();
    supported.clear();
  });

  it('downloads native Artifact bytes and persists them in Canvas storage', async () => {
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
    persistCanvasArtifactBytes.mockImplementation(async (_interaction, artifact, _sourceKey, bytes) => ({
      ...artifact,
      id: 'a'.repeat(40),
      uri: `/api/canvas/artifacts/canvas-1/interaction-1/${'a'.repeat(40)}`,
      storage: 'canvas',
      available: true,
      sizeBytes: bytes.byteLength,
    }));
    const { reconcileTranscriptSnapshot } = await import('./canvas-reconciler.js');
    const snapshot = await reconcileTranscriptSnapshot(interaction());

    expect(snapshot.agentOutput).toBe('done');
    expect(snapshot.artifactPersistenceComplete).toBe(true);
    expect(snapshot.artifacts).toEqual([
      expect.objectContaining({
        gatewayArtifactId: 'artifact_native',
        storage: 'canvas',
        available: true,
      }),
    ]);
    expect(persistCanvasArtifactBytes).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ gatewayArtifactId: 'artifact_native' }),
      'openclaw-artifact:main:artifact_native',
      Buffer.from([1, 2, 3]),
      'image/png',
    );
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
});
