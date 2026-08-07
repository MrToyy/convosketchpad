import type { CanvasStore } from '../persistence/canvas-store.js';
import type { CanvasAttachment, InteractionRecord, SendReservation } from '../model.js';
import type { AgentRuntime, AgentProfileRef } from '../../agent-runtimes/contract.js';
import { dispatchCanvasSend } from '../../canvas-send-coordinator.js';
import { CanvasApplicationError } from './errors.js';

export interface SubmitCanvasSendCommand {
  branchId: string;
  expectedHeadInteractionId?: string | null;
  expectedAgentRef: AgentProfileRef;
  userInput: string;
  attachmentIds: string[];
}

export interface ResubmitCanvasInteractionCommand {
  interactionId: string;
  expectedAgentRef: AgentProfileRef;
}

export type SubmitCanvasSendResult =
  | { kind: 'interaction'; interaction: InteractionRecord }
  | { kind: 'operation'; operation: SendReservation }
  | {
    kind: 'rejected';
    operation: SendReservation;
    error: string;
    status: 422 | 503;
  };

export class CanvasSendApplicationError extends CanvasApplicationError {}

interface CanvasSendServiceDependencies {
  store: CanvasStore;
  runtime?: AgentRuntime;
  runtimeResolver?: (runtimeId: string) => AgentRuntime;
  dispatch?: typeof dispatchCanvasSend;
}

export class CanvasSendService {
  private readonly store: CanvasStore;
  private readonly runtime?: AgentRuntime;
  private readonly runtimeResolver: (runtimeId: string) => AgentRuntime;
  private readonly dispatch: typeof dispatchCanvasSend;

  constructor(dependencies: CanvasSendServiceDependencies) {
    this.store = dependencies.store;
    this.runtime = dependencies.runtime;
    this.runtimeResolver = dependencies.runtimeResolver || (() => {
      throw new Error('runtime_resolver_not_configured');
    });
    this.dispatch = dependencies.dispatch || dispatchCanvasSend;
  }

  private resolveAttachments(
    ownerId: string,
    canvasId: string,
    attachmentIds: string[],
  ): CanvasAttachment[] {
    const attachments = this.store.getOwnedCanvasAttachments(ownerId, canvasId, attachmentIds);
    if (attachments.length !== attachmentIds.length) {
      throw new CanvasSendApplicationError(
        'attachment_not_found',
        422,
        'Attachment not found or not owned by this Canvas',
      );
    }
    return attachments;
  }

  private async refreshConversationIdentity(
    ownerId: string,
    branchId: string,
  ): Promise<void> {
    try {
      const context = this.store.getOwnedBranchRuntimeContext(ownerId, branchId);
      if (!context) return;
      const runtime = this.runtime || this.runtimeResolver(context.runtimeId);
      const inspection = await runtime.inspectConversation(context.conversationRef);
      if (!inspection) return;
      if (inspection.exists) {
        this.store.observeBranchConversation(
          branchId,
          inspection.conversationRef,
          inspection.instanceId,
        );
      } else {
        this.store.markBranchConversationMissing(branchId);
      }
    } catch (error) {
      console.warn(
        '[canvas] Conversation identity preflight skipped:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  private async shouldForceSessionRecovery(
    ownerId: string,
    branchId: string,
  ): Promise<boolean> {
    const branch = this.store.getOwnedBranch(ownerId, branchId);
    if (!branch || branch.conversationState !== 'active') return false;
    if (branch.conversationIntegrity === 'drifted') return false;
    const context = this.store.getOwnedBranchRuntimeContext(ownerId, branchId);
    if (!context) return true;
    const runtime = this.runtime || this.runtimeResolver(context.runtimeId);
    const preparation = await runtime.prepareConversation(context.conversationRef, {
      conversationStartedAt: context.conversationStartedAt,
      lastInteractionAt: context.lastInteractionAt,
    });
    return preparation.outcome === 'recreated';
  }

  async submit(
    ownerId: string,
    command: SubmitCanvasSendCommand,
  ): Promise<SubmitCanvasSendResult> {
    const branch = this.store.getOwnedBranch(ownerId, command.branchId);
    if (!branch) throw new CanvasSendApplicationError('not_found', 404, 'Not found');
    const canvas = this.store.getCanvas(ownerId, branch.canvasId);
    if (!canvas) throw new CanvasSendApplicationError('not_found', 404, 'Not found');
    if (
      canvas.agentRef.runtimeId !== command.expectedAgentRef.runtimeId
      || canvas.agentRef.profileId !== command.expectedAgentRef.profileId
    ) {
      throw new CanvasSendApplicationError('agent_changed', 409);
    }
    const attachments = this.resolveAttachments(ownerId, canvas.id, command.attachmentIds);

    if (branch.conversationState === 'active') {
      await this.refreshConversationIdentity(ownerId, branch.id);
    }
    const forceSessionRecovery = branch.conversationState === 'active'
      ? await this.shouldForceSessionRecovery(ownerId, branch.id)
      : false;
    const reservation = this.store.prepareSend(ownerId, {
      branchId: branch.id,
      expectedHeadInteractionId: command.expectedHeadInteractionId,
      userInput: command.userInput,
      attachments,
      forceSessionRecovery,
    });
    return this.dispatchReservation(reservation);
  }

  async resubmit(
    ownerId: string,
    command: ResubmitCanvasInteractionCommand,
  ): Promise<SubmitCanvasSendResult> {
    const source = this.store.getOwnedInteraction(ownerId, command.interactionId);
    if (!source) throw new CanvasSendApplicationError('not_found', 404, 'Not found');
    if (
      source.runtimeId !== command.expectedAgentRef.runtimeId
      || source.agentProfileId !== command.expectedAgentRef.profileId
    ) {
      throw new CanvasSendApplicationError('agent_changed', 409);
    }
    const attachmentIds = source.attachments.map((attachment) => attachment.id);
    if (attachmentIds.some((id) => !id)) {
      throw new CanvasSendApplicationError(
        'source_attachment_unavailable',
        422,
        'source_attachment_unavailable',
      );
    }
    let attachments: CanvasAttachment[];
    try {
      attachments = this.resolveAttachments(
        ownerId,
        source.canvasId,
        attachmentIds as string[],
      );
    } catch (error) {
      if (error instanceof CanvasSendApplicationError && error.code === 'attachment_not_found') {
        throw new CanvasSendApplicationError(
          'source_attachment_unavailable',
          422,
          'source_attachment_unavailable',
        );
      }
      throw error;
    }
    let reservation: SendReservation;
    try {
      reservation = this.store.prepareInteractionResubmission(ownerId, {
        interactionId: source.id,
        expectedAgentRef: command.expectedAgentRef,
        attachments,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'source_attachment_unavailable') {
        throw new CanvasSendApplicationError(
          'source_attachment_unavailable',
          422,
          'source_attachment_unavailable',
        );
      }
      throw error;
    }
    return this.dispatchReservation(reservation);
  }

  private async dispatchReservation(
    reservation: SendReservation,
  ): Promise<SubmitCanvasSendResult> {
    const result = await this.dispatch(reservation.id);
    if ('agentOutput' in result) return { kind: 'interaction', interaction: result };
    if (result.status === 'failed') {
      const error = result.error || 'send_rejected';
      return {
        kind: 'rejected',
        operation: result,
        error,
        status: error === 'runtime_text_input_unsupported' ? 503 : 422,
      };
    }
    return { kind: 'operation', operation: result };
  }
}
