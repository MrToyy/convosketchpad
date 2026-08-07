import type { CanvasArtifact } from '../model.js';

const UNIVERSAL_ARTIFACT_WATCH_MS = 120_000;

export interface ArtifactWatchSnapshot {
  artifacts: CanvasArtifact[];
  artifactPersistenceComplete?: boolean;
  artifactWarnings?: string[];
}

export function artifactSyncStateDuringObservation(
  snapshot: ArtifactWatchSnapshot | null | undefined,
): 'observing' | 'synced' {
  return snapshot
    && snapshot.artifacts.length > 0
    && snapshot.artifactPersistenceComplete !== false
    && (snapshot.artifactWarnings?.length || 0) === 0
    ? 'synced'
    : 'observing';
}

function snapshotNeedsExtendedArtifactWatch(
  snapshot: ArtifactWatchSnapshot | null | undefined,
): boolean {
  return Boolean(
    snapshot
    && (
      snapshot.artifacts.length > 0
      || snapshot.artifactPersistenceComplete === false
      || (snapshot.artifactWarnings?.length || 0) > 0
    )
  );
}

export function terminalArtifactSync(
  snapshot: ArtifactWatchSnapshot | null | undefined,
): 'synced' | 'degraded' {
  return snapshot
    && snapshot.artifactPersistenceComplete !== false
    && (snapshot.artifactWarnings?.length || 0) === 0
    ? 'synced'
    : 'degraded';
}

export function evaluateArtifactWatch(
  snapshot: ArtifactWatchSnapshot | null | undefined,
  elapsedMs: number,
  finalAttempt: boolean,
): { stop: boolean; artifactSync: 'pending' | 'synced' | 'degraded' } {
  const stop = finalAttempt
    || (elapsedMs >= UNIVERSAL_ARTIFACT_WATCH_MS && !snapshotNeedsExtendedArtifactWatch(snapshot));
  return {
    stop,
    artifactSync: stop ? terminalArtifactSync(snapshot) : 'pending',
  };
}
