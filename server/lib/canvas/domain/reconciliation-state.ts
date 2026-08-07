import type {
  CanvasArtifact,
  InteractionContextSnapshot,
  InteractionExecutionState,
} from '../model.js';
import { artifactSyncStateDuringObservation } from './artifact-watch.js';

interface ReconciliationInteractionState {
  executionState: InteractionExecutionState;
  error: string | null;
  agentOutput: string;
  artifacts: CanvasArtifact[];
}

interface ReconciliationSnapshot {
  agentOutput: string;
  artifacts: CanvasArtifact[];
  fingerprint: string;
  artifactWarnings?: string[];
}

export interface ReconciliationFinishInput {
  status?: 'completed' | 'failed';
  artifactSync: 'synced' | 'pending' | 'degraded';
  phase?: 'synced' | 'pending' | 'degraded';
  terminalAt: number;
  executionError?: string;
  reconciliationError?: string;
  contextSnapshot?: InteractionContextSnapshot;
}

export function buildReconciledInteractionUpdate(
  interaction: ReconciliationInteractionState,
  snapshot: ReconciliationSnapshot | null,
  input: ReconciliationFinishInput,
  now = Date.now(),
) {
  const status = input.status || (interaction.executionState === 'failed' ? 'failed' : 'completed');
  const executionError = status === 'failed'
    ? input.executionError ?? interaction.error ?? 'Agent Runtime turn failed'
    : null;
  const lastError = input.reconciliationError ?? executionError;
  const artifactObservationPending = input.artifactSync === 'pending';
  const artifactSyncState = input.artifactSync === 'pending'
    ? artifactSyncStateDuringObservation(snapshot)
    : input.artifactSync;

  return {
    status,
    agentOutput: snapshot?.agentOutput || interaction.agentOutput || executionError || '',
    artifacts: snapshot ? snapshot.artifacts : interaction.artifacts,
    artifactSyncState,
    artifactObservationPending,
    terminalAt: input.terminalAt,
    error: executionError,
    reconciliation: {
      phase: input.phase || input.artifactSync,
      artifactSync: input.artifactSync,
      terminalAt: input.terminalAt,
      settledAt: now,
      lastCheckedAt: now,
      ...(snapshot ? { fingerprint: snapshot.fingerprint } : {}),
      artifactWarnings: snapshot?.artifactWarnings || [],
      ...(lastError ? { lastError } : { lastError: null }),
    },
    ...(input.contextSnapshot ? { contextSnapshot: input.contextSnapshot } : {}),
  };
}
