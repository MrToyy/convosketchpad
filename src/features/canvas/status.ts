import type { CanvasGraph } from './types';

export interface ActiveCanvasContext {
  usedTokens: number;
  contextLimit: number;
}

export interface CanvasStatusStats {
  branchCount: number;
  workingCount: number;
  activeContext?: ActiveCanvasContext;
}

export function contextForComposerSource(
  graph: Pick<CanvasGraph, 'interactions'> | null,
  sourceInteractionId: string | null,
): ActiveCanvasContext | undefined {
  if (!graph || !sourceInteractionId) return undefined;
  const snapshot = graph.interactions.find(
    (interaction) => interaction.id === sourceInteractionId,
  )?.contextSnapshot;
  if (!snapshot) return undefined;
  return {
    usedTokens: snapshot.usedTokens,
    contextLimit: snapshot.contextLimit,
  };
}

export function deriveCanvasStatusCounts(
  graph: Pick<CanvasGraph, 'branches' | 'interactions' | 'pendingSends'> | null,
): Pick<CanvasStatusStats, 'branchCount' | 'workingCount'> {
  if (!graph) return { branchCount: 0, workingCount: 0 };
  const workingBranches = new Set<string>();
  for (const operation of graph.pendingSends) {
    if (operation.status === 'prepared') workingBranches.add(operation.branchId);
  }
  for (const interaction of graph.interactions) {
    if (interaction.executionState === 'running') workingBranches.add(interaction.branchId);
  }
  return {
    branchCount: graph.branches.length,
    workingCount: workingBranches.size,
  };
}
