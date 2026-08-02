export type SendMaterialization =
  | 'lazy-root'
  | 'continue-existing'
  | 'checkpoint-delta'
  | 'canonical-replay'
  | 'session-recovery';

export type SendDispatchState =
  | 'reserved'
  | 'awaiting_media'
  | 'dispatching'
  | 'ambiguous'
  | 'acknowledged'
  | 'failed';

export interface CanvasContextResource {
  id: string;
  contentHash?: string;
  sourceInteractionId: string;
  source: 'user_attachment' | 'agent_artifact';
  replayRef?: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  uri: string;
  available: boolean;
  warning?: string;
}

export interface CanonicalCanvasSnapshot {
  version: 2;
  interactions: Array<{ id: string; user: string; assistant: string }>;
  resources: CanvasContextResource[];
}

export interface CanvasSendBranchState {
  kind: 'root' | 'fork';
  conversationState: 'draft' | 'active';
  headInteractionId: string | null;
  conversationIntegrity: 'unknown' | 'healthy' | 'drifted';
}

export interface CanvasSendPlanDecision {
  materialization: SendMaterialization;
  expectedHeadInteractionId: string | null;
  requiresCanonicalSnapshot: boolean;
  replayReason?: 'canonical-replay' | 'session-recovery';
}

export class CanvasDomainError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'CanvasDomainError';
    this.code = code;
  }
}

export function decideCanvasSendPlan(input: {
  branch: CanvasSendBranchState;
  expectedHeadInteractionId?: string | null;
  forceSessionRecovery?: boolean;
}): CanvasSendPlanDecision {
  const { branch } = input;
  if (branch.conversationState === 'draft' && branch.kind === 'root' && !branch.headInteractionId) {
    return {
      materialization: 'lazy-root',
      expectedHeadInteractionId: null,
      requiresCanonicalSnapshot: false,
    };
  }
  if (branch.conversationState === 'draft' && branch.kind === 'fork' && !branch.headInteractionId) {
    return {
      materialization: 'canonical-replay',
      expectedHeadInteractionId: null,
      requiresCanonicalSnapshot: true,
      replayReason: 'canonical-replay',
    };
  }
  if (
    branch.conversationState === 'active'
    && branch.headInteractionId
    && input.expectedHeadInteractionId === branch.headInteractionId
  ) {
    const recovery = branch.conversationIntegrity === 'drifted' || input.forceSessionRecovery;
    return recovery
      ? {
        materialization: 'session-recovery',
        expectedHeadInteractionId: branch.headInteractionId,
        requiresCanonicalSnapshot: true,
        replayReason: 'session-recovery',
      }
      : {
        materialization: 'continue-existing',
        expectedHeadInteractionId: branch.headInteractionId,
        requiresCanonicalSnapshot: false,
      };
  }
  throw new CanvasDomainError('invalid_branch_transition');
}
