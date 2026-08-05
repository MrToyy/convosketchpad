import { describe, expect, it } from 'vitest';
import type { InteractionRecord } from './canvas/model.js';
import {
  artifactSyncStateDuringObservation,
  compareReconciledInteractions,
  evaluateArtifactWatch,
  interactionHasPendingUpdates,
  mergeArtifacts,
} from './canvas-reconciler.js';

function interaction(overrides: Partial<InteractionRecord> = {}): InteractionRecord {
  return {
    id: 'interaction-1',
    version: 1,
    branchId: 'branch-1',
    parentInteractionId: null,
    runtimeTurnId: 'run-1',
    userInput: '请生成图片',
    agentOutput: '',
    status: 'streaming',
    executionState: 'running',
    artifactSyncState: 'not_started',
    terminalAt: null,
    error: null,
    attachments: [],
    artifacts: [],
    executionMetadata: {},
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('Canvas transcript reconciliation', () => {
  it('ignores reconciliation heartbeat timestamps but detects Graph-visible changes', () => {
    const before = interaction({
      status: 'completed',
      agentOutput: 'done',
      executionMetadata: {
        reconciliation: {
          phase: 'pending',
          artifactSync: 'pending',
          lastCheckedAt: 1_000,
        },
      },
    });
    const heartbeatOnly = {
      ...before,
      executionMetadata: {
        reconciliation: {
          phase: 'pending',
          artifactSync: 'pending',
          lastCheckedAt: 2_000,
        },
      },
    };
    expect(compareReconciledInteractions(before, heartbeatOnly).graphChanged).toBe(false);
    expect(compareReconciledInteractions(before, {
      ...heartbeatOnly,
      artifacts: [{ name: 'late.png', uri: '/late.png' }],
    })).toMatchObject({ artifactChanged: true, graphChanged: true });
    expect(compareReconciledInteractions(before, {
      ...heartbeatOnly,
      executionMetadata: {
        reconciliation: { phase: 'synced', artifactSync: 'synced' },
      },
    })).toMatchObject({ reconciliationChanged: true, graphChanged: false });
  });

  it('treats synced and degraded records as terminal refresh states', () => {
    expect(interactionHasPendingUpdates(interaction())).toBe(true);
    expect(interactionHasPendingUpdates(interaction({
      status: 'completed',
      executionState: 'completed',
      artifactSyncState: 'observing',
      executionMetadata: { reconciliation: { artifactSync: 'pending' } },
    }))).toBe(true);
    expect(interactionHasPendingUpdates(interaction({
      status: 'completed',
      executionState: 'completed',
      artifactSyncState: 'synced',
      executionMetadata: { reconciliation: { artifactSync: 'synced' } },
    }))).toBe(false);
    expect(interactionHasPendingUpdates(interaction({
      status: 'completed',
      executionState: 'completed',
      artifactSyncState: 'degraded',
      executionMetadata: { reconciliation: { artifactSync: 'degraded' } },
    }))).toBe(false);
  });

  it('uses a two-minute universal Artifact watch and extends evidence to the final attempt', () => {
    const textOnly = {
      agentOutput: 'done',
      artifacts: [],
      fingerprint: 'text-only',
      matchedInteraction: true,
      artifactPersistenceComplete: true,
      artifactWarnings: [],
    };
    expect(evaluateArtifactWatch(textOnly, 119_999, false)).toEqual({
      stop: false,
      artifactSync: 'pending',
    });
    expect(evaluateArtifactWatch(textOnly, 120_000, false)).toEqual({
      stop: true,
      artifactSync: 'synced',
    });

    const withArtifact = {
      ...textOnly,
      artifacts: [{ name: 'late.png', uri: '/late.png' }],
    };
    expect(evaluateArtifactWatch(withArtifact, 120_000, false)).toEqual({
      stop: false,
      artifactSync: 'pending',
    });
    expect(evaluateArtifactWatch(withArtifact, 60 * 60_000, true)).toEqual({
      stop: true,
      artifactSync: 'synced',
    });
    expect(evaluateArtifactWatch({
      ...textOnly,
      artifactPersistenceComplete: false,
      artifactWarnings: ['download failed'],
    }, 60 * 60_000, true)).toEqual({
      stop: true,
      artifactSync: 'degraded',
    });
    expect(evaluateArtifactWatch({
      ...textOnly,
      agentOutput: '',
      matchedInteraction: false,
    }, 60 * 60_000, true)).toEqual({
      stop: true,
      artifactSync: 'synced',
    });
  });

  it('shows persisted Artifacts as synced while the late-Artifact observation continues', () => {
    expect(artifactSyncStateDuringObservation({
      agentOutput: 'done',
      artifacts: [{
        name: 'result.png',
        uri: '/api/canvas/artifacts/canvas-1/interaction-1/artifact-1',
        storage: 'canvas',
        available: true,
      }],
      fingerprint: 'persisted',
      matchedInteraction: true,
      artifactPersistenceComplete: true,
      artifactWarnings: [],
    })).toBe('synced');

    expect(artifactSyncStateDuringObservation({
      agentOutput: 'done',
      artifacts: [{
        name: 'result.png',
        uri: '/source/result.png',
        storage: 'source',
        available: false,
        warning: 'download failed',
      }],
      fingerprint: 'failed',
      matchedInteraction: true,
      artifactPersistenceComplete: false,
      artifactWarnings: ['download failed'],
    })).toBe('observing');
  });

  it('deduplicates legacy file routes and raw paths in favor of the persisted copy', () => {
    expect(mergeArtifacts([
      {
        name: 'result.png',
        uri: '/Users/example/result.png',
        sourceUri: '/Users/example/result.png',
        storage: 'source',
        available: false,
        warning: 'source is not allowed',
      },
      {
        name: 'result.png',
        uri: '/api/canvas/artifacts/canvas-1/interaction-1/artifact-1',
        sourceUri: '/api/files?path=%2FUsers%2Fexample%2Fresult.png',
        storage: 'canvas',
        available: true,
      },
    ])).toEqual([
      expect.objectContaining({
        storage: 'canvas',
        available: true,
        sourceUri: '/api/files?path=%2FUsers%2Fexample%2Fresult.png',
      }),
    ]);
  });

});
