import { describe, expect, it } from 'vitest';
import { buildReconciledInteractionUpdate } from './reconciliation-state.js';

const interaction = {
  executionState: 'running' as const,
  error: null,
  agentOutput: '',
  artifacts: [],
};

describe('Canvas reconciliation terminal state', () => {
  it('keeps execution failure independent from Artifact observation', () => {
    const update = buildReconciledInteractionUpdate(interaction, {
      agentOutput: 'partial result',
      artifacts: [],
      fingerprint: 'snapshot-1',
      artifactWarnings: ['artifact unavailable'],
    }, {
      status: 'failed',
      artifactSync: 'pending',
      terminalAt: 10_000,
      executionError: 'OpenClaw run failed',
      reconciliationError: 'Transcript read was incomplete',
    }, 11_000);

    expect(update).toMatchObject({
      status: 'failed',
      error: 'OpenClaw run failed',
      artifactSyncState: 'observing',
      artifactObservationPending: true,
      reconciliation: {
        artifactSync: 'pending',
        lastError: 'Transcript read was incomplete',
      },
    });
  });

  it('preserves the run failure when a later Artifact read fails', () => {
    const update = buildReconciledInteractionUpdate({
      ...interaction,
      executionState: 'failed',
      error: 'OpenClaw run failed',
    }, null, {
      artifactSync: 'degraded',
      terminalAt: 10_000,
      reconciliationError: 'Artifact retry exhausted',
    });

    expect(update.error).toBe('OpenClaw run failed');
    expect(update.reconciliation.lastError).toBe('Artifact retry exhausted');
  });

  it('does not expose a reconciliation read error as an execution error', () => {
    const update = buildReconciledInteractionUpdate(interaction, null, {
      status: 'completed',
      artifactSync: 'degraded',
      terminalAt: 10_000,
      reconciliationError: 'Artifact retry exhausted',
    });

    expect(update.error).toBeNull();
    expect(update.reconciliation.lastError).toBe('Artifact retry exhausted');
  });
});
