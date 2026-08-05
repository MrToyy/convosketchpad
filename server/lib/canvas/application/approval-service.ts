import type { AgentRuntime, ApprovalResolution } from '../../agent-runtimes/contract.js';
import { RuntimeOperationError } from '../../agent-runtimes/contract.js';
import type { CanvasStore } from '../persistence/canvas-store.js';
import type { InteractionApprovalRecord } from '../model.js';
import { CanvasApplicationError } from './errors.js';

type ApprovalStore = Pick<
  CanvasStore,
  'claimInteractionApproval' | 'finishInteractionApproval'
>;

export type ResolveCanvasApprovalResult = {
  outcome: 'accepted' | 'rejected' | 'unknown';
  approval: InteractionApprovalRecord;
  error?: string;
};

export class CanvasApprovalService {
  private readonly store: ApprovalStore;
  private readonly runtimeResolver: (
    runtimeId: string,
  ) => Pick<AgentRuntime, 'resolveApproval'>;

  constructor(
    store: ApprovalStore,
    runtimeResolver: (runtimeId: string) => Pick<AgentRuntime, 'resolveApproval'>,
  ) {
    this.store = store;
    this.runtimeResolver = runtimeResolver;
  }

  async resolve(ownerId: string, approvalId: string, input: {
    resolution: ApprovalResolution;
    confirmed: boolean;
  }): Promise<ResolveCanvasApprovalResult> {
    let claimed: ReturnType<ApprovalStore['claimInteractionApproval']> | null = null;
    try {
      claimed = this.store.claimInteractionApproval(
        ownerId,
        approvalId,
        input.resolution,
        input.confirmed,
      );
      const result = await this.runtimeResolver(claimed.runtimeId).resolveApproval({
        approvalRef: claimed.approvalRef,
        resolution: claimed.resolution || input.resolution,
      });
      const approval = this.store.finishInteractionApproval(
        claimed.id,
        result.outcome,
        result.outcome === 'accepted' ? undefined : result.error.message,
      );
      if (!approval) throw new Error('approval_resolution_state_missing');
      return {
        outcome: result.outcome,
        approval,
        ...(result.outcome === 'accepted' ? {} : { error: result.error.message }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'approval_resolution_failed';
      if (!claimed) {
        if (message === 'not_found') throw new CanvasApplicationError(message, 404, 'Not found');
        if (message === 'approval_expired') throw new CanvasApplicationError(message, 410);
        if (message.startsWith('approval_')) throw new CanvasApplicationError(message, 409);
        throw new CanvasApplicationError(
          'approval_resolution_failed',
          502,
          'approval_resolution_failed',
          { cause: error },
        );
      }
      const terminal = error instanceof RuntimeOperationError
        && ['validation', 'unsupported', 'unauthorized', 'rejected', 'conflict'].includes(error.kind);
      const approval = this.store.finishInteractionApproval(
        claimed.id,
        terminal ? 'rejected' : 'unknown',
        message,
      );
      if (!approval) {
        throw new CanvasApplicationError('approval_resolution_state_missing', 502);
      }
      return {
        outcome: terminal ? 'rejected' : 'unknown',
        approval,
        error: terminal ? message : 'approval_resolution_unconfirmed',
      };
    }
  }
}
