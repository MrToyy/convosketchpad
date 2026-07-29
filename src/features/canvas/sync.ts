import type { CanvasGraph, CanvasSyncBatch, SendReservation } from './types';

function upsertById<T extends { id: string }>(
  current: T[],
  updates: T[],
  removedIds: string[],
  accept?: (previous: T | undefined, update: T) => boolean,
): T[] {
  const removed = new Set(removedIds);
  const values = new Map(current.filter((item) => !removed.has(item.id)).map((item) => [item.id, item]));
  for (const update of updates) {
    const previous = values.get(update.id);
    if (!accept || accept(previous, update)) values.set(update.id, update);
  }
  return [...values.values()];
}

function pendingOperation(operation: SendReservation): boolean {
  return operation.status === 'prepared';
}

export function graphHasPendingUpdates(graph: Pick<CanvasGraph, 'interactions' | 'pendingSends'>): boolean {
  return graph.pendingSends.some(pendingOperation)
    || graph.interactions.some((interaction) =>
      interaction.executionState === 'running'
      || interaction.executionState === 'unconfirmed'
      || interaction.artifactSyncState === 'observing');
}

export function applyCanvasSyncBatch(graph: CanvasGraph, batch: CanvasSyncBatch): CanvasGraph {
  if (batch.cursor <= graph.cursor) return graph;
  const interactions = upsertById(
    graph.interactions,
    batch.interactions,
    batch.removed.interactionIds,
    (previous, update) => !previous || update.version >= previous.version,
  );
  const pendingSends = upsertById(
    graph.pendingSends,
    batch.sendOperations,
    [
      ...batch.removed.sendOperationIds,
      ...batch.sendOperations.filter((operation) => !pendingOperation(operation)).map((operation) => operation.id),
    ],
  ).filter(pendingOperation);
  let failedSends = graph.failedSends.filter((operation) =>
    !batch.removed.sendOperationIds.includes(operation.id));
  const orderedOperations = [...batch.sendOperations]
    .sort((left, right) => left.createdAt - right.createdAt);
  for (const operation of orderedOperations) {
    failedSends = failedSends.filter((current) =>
      current.id !== operation.id && current.branchId !== operation.branchId);
    if (operation.status === 'failed' && !operation.interactionId) {
      failedSends.push(operation);
    }
  }
  const next: CanvasGraph = {
    ...graph,
    cursor: batch.cursor,
    canvas: batch.canvas || graph.canvas,
    branches: upsertById(graph.branches, batch.branches, batch.removed.branchIds),
    interactions,
    pendingSends,
    failedSends,
  };
  return { ...next, hasPendingUpdates: graphHasPendingUpdates(next) };
}
