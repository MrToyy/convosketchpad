import { createHash } from 'node:crypto';
import {
  cleanupOrphanCanvasArtifacts,
  materializeCanvasArtifacts,
} from './canvas-artifact-store.js';
import type { AgentRuntimeResolver } from './canvas/application/ports.js';
import { mergeEquivalentArtifacts } from './canvas-artifact-identity.js';
import {
  evaluateArtifactWatch,
  terminalArtifactSync,
} from './canvas/domain/artifact-watch.js';
import {
  buildReconciledInteractionUpdate,
  type ReconciliationFinishInput,
} from './canvas/domain/reconciliation-state.js';
import {
  captureInteractionCompletionSession,
  type InteractionCompletionConversation,
} from './canvas-context-snapshot.js';
import type { CanvasStore } from './canvas/persistence/canvas-store.js';
import type { CanvasArtifact, InteractionRecord, OwnedInteractionRecord } from './canvas/model.js';
import { publishCanvasChanged } from './canvas-sync.js';

export const CANVAS_SETTLE_MIN_MS = 4_000;
export const CANVAS_SETTLE_MAX_MS = 15_000;

const FOREGROUND_OFFSETS_MS = [500, 1_500, 3_000, 4_000, 6_000, 9_000, 12_000, 15_000];
const BACKGROUND_OFFSETS_MS = [30_000, 60_000, 120_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const MAX_MONITOR_AGE_MS = 24 * 60 * 60 * 1_000;
const SLOW_MONITOR_AFTER_MS = 60 * 60 * 1_000;

export interface CanvasTranscriptSnapshot {
  agentOutput: string;
  artifacts: CanvasArtifact[];
  fingerprint: string;
  matchedInteraction: boolean;
  sessionId?: string;
  artifactPersistenceComplete?: boolean;
  artifactWarnings?: string[];
}

interface SettlementState {
  terminalAt: number;
  lateRecovery: boolean;
  foregroundIndex: number;
  backgroundIndex: number;
  previousFingerprint: string | null;
  stableReads: number;
  best: CanvasTranscriptSnapshot | null;
  failure?: string;
}

interface MonitorState {
  timer: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  settlement?: SettlementState;
}

const monitors = new Map<string, MonitorState>();
let configuredRuntimeResolver: AgentRuntimeResolver | null = null;
let configuredCanvasStore: CanvasStore | null = null;

function canvasStore(): CanvasStore {
  if (!configuredCanvasStore) throw new Error('Canvas reconciler is not configured');
  return configuredCanvasStore;
}

function resolveRuntime(runtimeId: string) {
  if (!configuredRuntimeResolver) throw new Error('Canvas reconciler is not configured');
  return configuredRuntimeResolver(runtimeId);
}

interface ReconciliationView {
  phase?: unknown;
  artifactSync?: unknown;
  artifactWarnings?: unknown;
  lastError?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function canvasTranscriptHasResponse(snapshot: CanvasTranscriptSnapshot | null | undefined): boolean {
  return Boolean(snapshot?.matchedInteraction
    && (snapshot.agentOutput.trim().length > 0 || snapshot.artifacts.length > 0));
}

function getReconciliation(interaction: InteractionRecord): Record<string, unknown> {
  return asRecord(interaction.executionMetadata.reconciliation) || {};
}

export function interactionHasPendingUpdates(interaction: InteractionRecord): boolean {
  return interaction.executionState === 'running'
    || interaction.executionState === 'unconfirmed'
    || interaction.artifactSyncState === 'observing';
}

function reconciliationView(interaction: InteractionRecord): ReconciliationView {
  const reconciliation = getReconciliation(interaction);
  return {
    phase: reconciliation.phase,
    artifactSync: reconciliation.artifactSync,
    artifactWarnings: reconciliation.artifactWarnings,
    lastError: reconciliation.lastError,
  };
}

function artifactsEqual(left: CanvasArtifact[], right: CanvasArtifact[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reconciliationViewEqual(left: InteractionRecord, right: InteractionRecord): boolean {
  return JSON.stringify(reconciliationView(left)) === JSON.stringify(reconciliationView(right));
}

export function compareReconciledInteractions(
  before: InteractionRecord,
  after: InteractionRecord,
): {
  statusChanged: boolean;
  outputChanged: boolean;
  artifactChanged: boolean;
  reconciliationChanged: boolean;
  graphChanged: boolean;
} {
  const statusChanged = after.executionState !== before.executionState;
  const outputChanged = after.agentOutput !== before.agentOutput;
  const artifactChanged = !artifactsEqual(after.artifacts, before.artifacts);
  const reconciliationChanged = !reconciliationViewEqual(after, before);
  return {
    statusChanged,
    outputChanged,
    artifactChanged,
    reconciliationChanged,
    graphChanged: after.version !== before.version || statusChanged || outputChanged || artifactChanged,
  };
}

function trackTimer(interactionId: string, delayMs: number, fn: () => void): void {
  const state = monitors.get(interactionId) || { timer: null, startedAt: Date.now() };
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    fn();
  }, Math.max(0, delayMs));
  state.timer.unref?.();
  monitors.set(interactionId, state);
}

function trackArtifactTimer(interactionId: string, delayMs: number, fn: () => void): void {
  const boundedDelay = Math.max(0, delayMs);
  canvasStore().scheduleArtifactSyncAttempt(interactionId, Date.now() + boundedDelay);
  trackTimer(interactionId, boundedDelay, fn);
}

function stopMonitor(interactionId: string): void {
  const state = monitors.get(interactionId);
  if (state?.timer) clearTimeout(state.timer);
  monitors.delete(interactionId);
}

export function mergeArtifacts(artifacts: CanvasArtifact[]): CanvasArtifact[] {
  return mergeEquivalentArtifacts(artifacts);
}

export async function reconcileTranscriptSnapshot(
  interaction: OwnedInteractionRecord,
  runtimeResolver: AgentRuntimeResolver = resolveRuntime,
): Promise<CanvasTranscriptSnapshot> {
  const runtime = runtimeResolver(interaction.runtimeId);
  if (!interaction.conversationRef) throw new Error('Interaction has no Runtime conversation reference');
  const extracted = await runtime.readTurn({
    profile: {
      runtimeId: runtime.id,
      profileId: interaction.agentProfileId,
    },
    conversationRef: interaction.conversationRef,
    turnRef: interaction.turnRef || null,
    userInput: interaction.userInput,
    createdAt: interaction.createdAt,
  });
  if (extracted.instanceId) {
    canvasStore().observeBranchConversation(
      interaction.branchId,
      interaction.conversationRef,
      extracted.instanceId,
    );
  }
  const extractedSources = new Set(extracted.artifacts.map((artifact) => artifact.sourceUri || artifact.uri));
  const retainedArtifacts = interaction.artifacts.filter((artifact) =>
    !extractedSources.has(artifact.sourceUri || artifact.uri));
  const materialized = await materializeCanvasArtifacts(
    interaction,
    [...extracted.artifacts as CanvasArtifact[], ...retainedArtifacts],
    runtimeResolver,
  );
  const artifacts = mergeArtifacts(materialized.artifacts);
  const warnings = [
    ...extracted.artifactWarnings,
    ...materialized.warnings,
    ...artifacts.flatMap((artifact) => artifact.warning ? [artifact.warning] : []),
  ];
  return {
    agentOutput: extracted.agentOutput,
    artifacts,
    matchedInteraction: extracted.matchedTurn,
    ...(extracted.instanceId ? { sessionId: extracted.instanceId } : {}),
    artifactPersistenceComplete: extracted.artifactDiscoveryComplete
      && materialized.complete
      && warnings.length === 0,
    artifactWarnings: warnings,
    fingerprint: createHash('sha256')
      .update(JSON.stringify({ agentOutput: extracted.agentOutput, artifacts }))
      .digest('hex'),
  };
}

async function captureSessionBeforeCompletion(
  interaction: OwnedInteractionRecord,
  snapshot: CanvasTranscriptSnapshot | null,
): Promise<InteractionCompletionConversation | undefined> {
  if (interaction.executionState !== 'running' && interaction.executionState !== 'unconfirmed') {
    return undefined;
  }
  try {
    return await captureInteractionCompletionSession(
      interaction.conversationRef!,
      snapshot?.sessionId || interaction.observedConversationInstanceId || interaction.conversationInstanceId || undefined,
      resolveRuntime(interaction.runtimeId),
    ) || undefined;
  } catch {
    return undefined;
  }
}

interface ReconciliationCompletionInput extends ReconciliationFinishInput {
  completionSessionId?: string;
}

function finish(
  interaction: OwnedInteractionRecord,
  snapshot: CanvasTranscriptSnapshot | null,
  input: ReconciliationCompletionInput,
): void {
  const { completionSessionId, ...reconciliationInput } = input;
  const updated = canvasStore().applyReconciledInteraction(
    interaction.id,
    buildReconciledInteractionUpdate(interaction, snapshot, reconciliationInput),
  );
  if (updated) {
    const { graphChanged } = compareReconciledInteractions(interaction, updated);
    const adopted = completionSessionId
      ? canvasStore().adoptRecoveredInteractionConversation(
        interaction.id,
        completionSessionId,
        reconciliationInput.contextSnapshot?.capturedAt,
      )
      : null;
    if (graphChanged || adopted) {
      publishCanvasChanged(interaction.ownerId, interaction.canvasId);
    }
  }
}

function scheduleNextSettlementRead(interaction: OwnedInteractionRecord, state: SettlementState): void {
  const now = Date.now();
  const elapsed = now - state.terminalAt;
  if (state.lateRecovery) {
    trackArtifactTimer(interaction.id, state.foregroundIndex === 0 ? 0 : 1_000, () => void settlementRead(interaction.id));
    return;
  }
  const offset = FOREGROUND_OFFSETS_MS.find((candidate) => candidate >= elapsed && candidate >= FOREGROUND_OFFSETS_MS[state.foregroundIndex]);
  trackArtifactTimer(
    interaction.id,
    Math.max(0, (offset ?? CANVAS_SETTLE_MAX_MS) - elapsed),
    () => void settlementRead(interaction.id),
  );
}

function nextBackgroundIndex(elapsed: number): number {
  const index = BACKGROUND_OFFSETS_MS.findIndex((offset) => offset > elapsed);
  return index >= 0 ? index : BACKGROUND_OFFSETS_MS.length - 1;
}

async function settlementRead(interactionId: string): Promise<void> {
  const state = monitors.get(interactionId);
  const settlement = state?.settlement;
  const interaction = canvasStore().getInteractionForReconciliation(interactionId);
  if (!state || !settlement || !interaction) {
    stopMonitor(interactionId);
    return;
  }
  canvasStore().markArtifactSyncAttempt(interactionId);

  let readError: string | undefined;
  try {
    const snapshot = await reconcileTranscriptSnapshot(interaction);
    settlement.best = snapshot;
    if (snapshot.fingerprint === settlement.previousFingerprint) settlement.stableReads += 1;
    else settlement.stableReads = 1;
    settlement.previousFingerprint = snapshot.fingerprint;
  } catch (error) {
    readError = error instanceof Error ? error.message : 'Failed to read Agent Runtime transcript';
  }

  const now = Date.now();
  const elapsed = now - settlement.terminalAt;
  const currentReconciliation = getReconciliation(interaction);
  canvasStore().updateReconciliationMetadata(interactionId, {
    phase: interaction.executionState === 'running' || interaction.executionState === 'unconfirmed'
      ? 'settling'
      : currentReconciliation.phase || 'pending',
    artifactSync: 'pending',
    terminalAt: settlement.terminalAt,
    lastCheckedAt: now,
    ...(readError ? { lastError: readError } : { lastError: null }),
  });

  if (settlement.failure) {
    const artifactWatch = evaluateArtifactWatch(
      settlement.best,
      elapsed,
      elapsed >= BACKGROUND_OFFSETS_MS[BACKGROUND_OFFSETS_MS.length - 1],
    );
    finish(interaction, settlement.best, {
      status: 'failed',
      artifactSync: artifactWatch.artifactSync,
      terminalAt: settlement.terminalAt,
      executionError: settlement.failure,
      reconciliationError: readError,
    });
    if (artifactWatch.stop) {
      stopMonitor(interactionId);
      return;
    }
    settlement.backgroundIndex = nextBackgroundIndex(elapsed);
    scheduleBackgroundRead(interaction.id, settlement);
    return;
  }

  if (settlement.lateRecovery) {
    const artifactWatch = evaluateArtifactWatch(
      settlement.best,
      elapsed,
      elapsed >= BACKGROUND_OFFSETS_MS[BACKGROUND_OFFSETS_MS.length - 1],
    );
    if (artifactWatch.stop) {
      const completionSession = canvasTranscriptHasResponse(settlement.best)
        ? await captureSessionBeforeCompletion(interaction, settlement.best)
        : undefined;
      finish(interaction, settlement.best, {
        artifactSync: artifactWatch.artifactSync,
        terminalAt: settlement.terminalAt,
        reconciliationError: readError,
        ...(completionSession?.contextSnapshot
          ? { contextSnapshot: completionSession.contextSnapshot }
          : {}),
        ...(completionSession ? { completionSessionId: completionSession.conversationInstanceId } : {}),
      });
      stopMonitor(interactionId);
      return;
    }
    if (canvasTranscriptHasResponse(settlement.best)) {
      const completionSession = await captureSessionBeforeCompletion(interaction, settlement.best);
      finish(interaction, settlement.best, {
        artifactSync: 'pending',
        terminalAt: settlement.terminalAt,
        reconciliationError: readError,
        ...(completionSession?.contextSnapshot
          ? { contextSnapshot: completionSession.contextSnapshot }
          : {}),
        ...(completionSession ? { completionSessionId: completionSession.conversationInstanceId } : {}),
      });
    }
    settlement.backgroundIndex = nextBackgroundIndex(elapsed);
    scheduleBackgroundRead(interaction.id, settlement);
    return;
  }

  settlement.foregroundIndex += 1;
  let responsePersisted = false;
  if (elapsed >= CANVAS_SETTLE_MIN_MS
    && settlement.stableReads >= 2
    && canvasTranscriptHasResponse(settlement.best)) {
    const completionSession = await captureSessionBeforeCompletion(interaction, settlement.best);
    finish(interaction, settlement.best, {
      artifactSync: 'pending',
      terminalAt: settlement.terminalAt,
      reconciliationError: readError,
      ...(completionSession?.contextSnapshot
        ? { contextSnapshot: completionSession.contextSnapshot }
        : {}),
      ...(completionSession ? { completionSessionId: completionSession.conversationInstanceId } : {}),
    });
    responsePersisted = true;
  }

  if (elapsed >= CANVAS_SETTLE_MAX_MS) {
    if (canvasTranscriptHasResponse(settlement.best)
      && !responsePersisted) {
      const completionSession = await captureSessionBeforeCompletion(interaction, settlement.best);
      finish(interaction, settlement.best, {
        artifactSync: 'pending',
        terminalAt: settlement.terminalAt,
        reconciliationError: readError,
        ...(completionSession?.contextSnapshot
          ? { contextSnapshot: completionSession.contextSnapshot }
          : {}),
        ...(completionSession ? { completionSessionId: completionSession.conversationInstanceId } : {}),
      });
    } else if (!canvasTranscriptHasResponse(settlement.best)) {
      canvasStore().updateReconciliationMetadata(interactionId, {
        phase: 'awaiting_response',
        artifactSync: 'pending',
        terminalAt: settlement.terminalAt,
        lastCheckedAt: now,
        lastError: readError || null,
      });
    }
    settlement.backgroundIndex = 0;
    scheduleBackgroundRead(interaction.id, settlement);
    return;
  }

  scheduleNextSettlementRead(interaction, settlement);
}

function scheduleBackgroundRead(interactionId: string, settlement: SettlementState): void {
  const offset = BACKGROUND_OFFSETS_MS[settlement.backgroundIndex];
  if (offset === undefined) {
    const interaction = canvasStore().getInteractionForReconciliation(interactionId);
    if (interaction) finish(interaction, settlement.best, {
      artifactSync: terminalArtifactSync(settlement.best),
      terminalAt: settlement.terminalAt,
    });
    stopMonitor(interactionId);
    return;
  }
  trackArtifactTimer(
    interactionId,
    Math.max(0, settlement.terminalAt + offset - Date.now()),
    () => void backgroundRead(interactionId),
  );
}

async function backgroundRead(interactionId: string): Promise<void> {
  const state = monitors.get(interactionId);
  const settlement = state?.settlement;
  const interaction = canvasStore().getInteractionForReconciliation(interactionId);
  if (!state || !settlement || !interaction) {
    stopMonitor(interactionId);
    return;
  }
  canvasStore().markArtifactSyncAttempt(interactionId);

  try {
    const snapshot = await reconcileTranscriptSnapshot(interaction);
    settlement.best = snapshot;
    settlement.previousFingerprint = snapshot.fingerprint;
    const finalAttempt = settlement.backgroundIndex === BACKGROUND_OFFSETS_MS.length - 1;
    const artifactWatch = evaluateArtifactWatch(
      snapshot,
      Date.now() - settlement.terminalAt,
      finalAttempt,
    );
    if (artifactWatch.stop) {
      finish(interaction, snapshot, {
        artifactSync: artifactWatch.artifactSync,
        terminalAt: settlement.terminalAt,
      });
      stopMonitor(interactionId);
      return;
    }
    if (canvasTranscriptHasResponse(snapshot)) {
      finish(interaction, snapshot, {
        artifactSync: 'pending',
        terminalAt: settlement.terminalAt,
      });
    } else {
      canvasStore().updateReconciliationMetadata(interactionId, {
        phase: 'awaiting_response',
        artifactSync: 'pending',
        terminalAt: settlement.terminalAt,
        lastCheckedAt: Date.now(),
        lastError: null,
      });
    }
  } catch (error) {
    const finalAttempt = settlement.backgroundIndex === BACKGROUND_OFFSETS_MS.length - 1;
    if (finalAttempt) {
      finish(interaction, settlement.best, {
        artifactSync: 'degraded',
        terminalAt: settlement.terminalAt,
        reconciliationError: error instanceof Error ? error.message : 'Failed to read Agent Runtime transcript',
      });
      stopMonitor(interactionId);
      return;
    }
    canvasStore().updateReconciliationMetadata(interactionId, {
      phase: 'pending',
      artifactSync: 'pending',
      lastCheckedAt: Date.now(),
      lastError: error instanceof Error ? error.message : 'Failed to read Agent Runtime transcript',
    });
  }

  settlement.backgroundIndex += 1;
  scheduleBackgroundRead(interactionId, settlement);
}

function beginSettlement(interaction: OwnedInteractionRecord, terminalAt: number, input?: { failure?: string; lateRecovery?: boolean }): void {
  const existing = monitors.get(interaction.id);
  if (existing?.settlement) return;
  const state: MonitorState = existing || { timer: null, startedAt: Date.now() };
  state.settlement = {
    terminalAt,
    lateRecovery: Boolean(input?.lateRecovery),
    foregroundIndex: 0,
    backgroundIndex: 0,
    previousFingerprint: null,
    stableReads: 0,
    best: null,
    ...(input?.failure ? { failure: input.failure } : {}),
  };
  monitors.set(interaction.id, state);
  const preserveTerminalArtifactState = Boolean(
    input?.lateRecovery
    && (interaction.artifactSyncState === 'synced' || interaction.artifactSyncState === 'degraded'),
  );
  canvasStore().updateInteractionCoordination(interaction.id, {
    artifactSyncState: preserveTerminalArtifactState ? interaction.artifactSyncState : 'observing',
    artifactObservationPending: true,
    terminalAt,
    error: input?.failure || null,
  });
  canvasStore().updateReconciliationMetadata(interaction.id, {
    phase: 'settling',
    artifactSync: 'pending',
    terminalAt,
    lastCheckedAt: Date.now(),
    lastError: null,
  });
  scheduleNextSettlementRead(interaction, state.settlement);
}

async function pollInteraction(interactionId: string): Promise<void> {
  const interaction = canvasStore().getInteractionForReconciliation(interactionId);
  if (!interaction) {
    stopMonitor(interactionId);
    return;
  }
  const reconciliation = getReconciliation(interaction);
  if (interaction.executionState !== 'running' && interaction.executionState !== 'unconfirmed') {
    if (!canvasStore().hasArtifactSyncJob(interactionId)) {
      stopMonitor(interactionId);
      return;
    }
    const terminalAt = asNumber(reconciliation.terminalAt) || interaction.updatedAt;
    beginSettlement(interaction, terminalAt, { lateRecovery: Date.now() - terminalAt > CANVAS_SETTLE_MAX_MS });
    return;
  }

  const age = Date.now() - interaction.createdAt;
  if (age >= MAX_MONITOR_AGE_MS) {
    const updated = canvasStore().updateInteractionCoordination(interactionId, {
      executionState: 'unconfirmed',
      artifactSyncState: 'degraded',
      error: 'Agent Runtime turn status could not be confirmed within 24 hours',
    });
    canvasStore().updateReconciliationMetadata(interactionId, {
      phase: 'status_unconfirmed',
      artifactSync: 'pending',
      lastCheckedAt: Date.now(),
      lastError: 'Agent Runtime turn status could not be confirmed within 24 hours',
    });
    if (updated) {
      publishCanvasChanged(interaction.ownerId, interaction.canvasId);
    }
    stopMonitor(interactionId);
    return;
  }

  try {
    const runtime = resolveRuntime(interaction.runtimeId);
    if (!interaction.conversationRef) throw new Error('Interaction has no Runtime conversation reference');
    const turn = await runtime.inspectTurn({
      profile: { runtimeId: runtime.id, profileId: interaction.agentProfileId },
      conversationRef: interaction.conversationRef,
      turnRef: interaction.turnRef || null,
      userInput: interaction.userInput,
      createdAt: interaction.createdAt,
    });
    if (turn.instanceId) {
      canvasStore().observeBranchConversation(interaction.branchId, interaction.conversationRef, turn.instanceId);
    }
    canvasStore().updateReconciliationMetadata(interactionId, {
      phase: 'monitoring',
      artifactSync: 'pending',
      lastCheckedAt: Date.now(),
      lastError: null,
    });
    if (turn.found && turn.terminal && turn.reflectsTurn) {
      const terminalAt = turn.terminalAt || Date.now();
      beginSettlement(interaction, terminalAt, {
        failure: turn.failure,
        lateRecovery: Date.now() - terminalAt > CANVAS_SETTLE_MAX_MS,
      });
      return;
    }

    if (asNumber(reconciliation.terminalHintAt)) {
      const snapshot = await reconcileTranscriptSnapshot(interaction);
      if (canvasTranscriptHasResponse(snapshot)) {
        beginSettlement(interaction, Date.now(), {
          failure: typeof reconciliation.failureHint === 'string' ? reconciliation.failureHint : undefined,
        });
        return;
      }
    }
  } catch (error) {
    canvasStore().updateReconciliationMetadata(interactionId, {
      phase: 'monitoring',
      artifactSync: 'pending',
      lastCheckedAt: Date.now(),
      lastError: error instanceof Error ? error.message : 'Agent Runtime unavailable',
    });
  }

  trackTimer(interactionId, age >= SLOW_MONITOR_AFTER_MS ? 30_000 : 5_000, () => void pollInteraction(interactionId));
}

export function scheduleCanvasInteractionReconciliation(interactionId: string, delayMs = 3_000): void {
  const existing = monitors.get(interactionId);
  if (existing?.settlement) return;
  trackTimer(interactionId, delayMs, () => void pollInteraction(interactionId));
}

export function signalCanvasInteractionTerminal(interactionId: string, ownerId: string, input?: {
  runtimeTurnId?: string;
  failureHint?: string;
}): OwnedInteractionRecord | null {
  const interaction = canvasStore().getOwnedInteraction(ownerId, interactionId);
  if (!interaction) return null;
  if (input?.runtimeTurnId && interaction.runtimeTurnId && input.runtimeTurnId !== interaction.runtimeTurnId) return interaction;
  if (interaction.executionState !== 'running' && interaction.executionState !== 'unconfirmed'
    && !canvasStore().hasArtifactSyncJob(interaction.id)) return interaction;
  const updated = canvasStore().updateReconciliationMetadata(interaction.id, {
    phase: 'terminal_hint_received',
    artifactSync: 'pending',
    terminalHintAt: Date.now(),
    terminalHintRunId: input?.runtimeTurnId || interaction.runtimeTurnId || null,
    failureHint: input?.failureHint || null,
    lastCheckedAt: Date.now(),
  });
  canvasStore().updateInteractionCoordination(interaction.id, {
    artifactSyncState: 'observing',
    terminalAt: Date.now(),
    error: input?.failureHint || null,
  });
  publishCanvasChanged(interaction.ownerId, interaction.canvasId);
  scheduleCanvasInteractionReconciliation(interaction.id, 0);
  return updated ? canvasStore().getOwnedInteraction(ownerId, interaction.id) : interaction;
}

export function startCanvasReconciler(store: CanvasStore, runtimeResolver: AgentRuntimeResolver): void {
  if (configuredCanvasStore) {
    if (configuredCanvasStore === store) return;
    throw new Error('A Canvas reconciler is already active in this process');
  }
  configuredCanvasStore = store;
  configuredRuntimeResolver = runtimeResolver;
  void cleanupOrphanCanvasArtifacts((canvasId) => canvasStore().canvasExists(canvasId))
    .catch((error) => console.warn('[canvas] Artifact orphan cleanup failed:', error instanceof Error ? error.message : error));
  rescanCanvasReconciliationCandidates();
}

export function rescanCanvasReconciliationCandidates(): void {
  const batchSize = 500;
  for (let offset = 0; ; offset += batchSize) {
    const batch = canvasStore().listReconciliationCandidates(batchSize, offset);
    for (const interaction of batch) {
      scheduleCanvasInteractionReconciliation(interaction.id, 0);
    }
    if (batch.length < batchSize) break;
  }
}

export function stopCanvasReconciler(): void {
  if (!configuredCanvasStore) return;
  for (const interactionId of [...monitors.keys()]) stopMonitor(interactionId);
  configuredRuntimeResolver = null;
  configuredCanvasStore = null;
}

export {
  artifactSyncStateDuringObservation,
  evaluateArtifactWatch,
} from './canvas/domain/artifact-watch.js';
