import type {
  CanvasAttachment,
  CanvasStore,
  InteractionRecord,
  SendReservation,
} from './canvas-db.js';
import { dispatchCanvasSend } from './canvas-send-coordinator.js';
import { config } from './config.js';
import {
  openClawCanvas,
  type OpenClawCanvasPort,
} from './openclaw-canvas.js';
import { sessionWillResetBeforeSend } from './openclaw-session-policy.js';

export interface SubmitCanvasSendCommand {
  branchId: string;
  expectedHeadInteractionId?: string | null;
  expectedAgentId: string;
  userInput: string;
  attachmentIds: string[];
}

export interface ResubmitCanvasInteractionCommand {
  interactionId: string;
  expectedAgentId: string;
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

export class CanvasSendApplicationError extends Error {
  readonly code: string;
  readonly status: 404 | 409 | 422;
  readonly publicMessage: string;

  constructor(code: string, status: 404 | 409 | 422, publicMessage = code) {
    super(code);
    this.name = 'CanvasSendApplicationError';
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

interface CanvasSendServiceDependencies {
  store: CanvasStore;
  gateway?: OpenClawCanvasPort;
  dispatch?: typeof dispatchCanvasSend;
  gatewayTimezone?: string;
}

export class CanvasSendService {
  private readonly store: CanvasStore;
  private readonly gateway: OpenClawCanvasPort;
  private readonly dispatch: typeof dispatchCanvasSend;
  private readonly gatewayTimezone: string;

  constructor(dependencies: CanvasSendServiceDependencies) {
    this.store = dependencies.store;
    this.gateway = dependencies.gateway || openClawCanvas;
    this.dispatch = dependencies.dispatch || dispatchCanvasSend;
    this.gatewayTimezone = dependencies.gatewayTimezone || config.gatewayTimezone;
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

  private async refreshSessionIdentity(
    branchId: string,
    sessionKey: string,
  ): Promise<void> {
    try {
      const inspection = await this.gateway.inspectSession(sessionKey);
      if (!inspection.listed) return;
      if (inspection.sessionId) this.store.observeBranchSession(branchId, inspection.sessionId);
      else this.store.markBranchSessionMissing(branchId);
    } catch (error) {
      console.warn(
        '[canvas] Session identity preflight skipped:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  private async shouldForceSessionRecovery(
    ownerId: string,
    branchId: string,
  ): Promise<boolean> {
    const branch = this.store.getOwnedBranch(ownerId, branchId);
    if (!branch || branch.sessionState !== 'active') return false;
    if (branch.sessionIntegrity === 'drifted') return false;
    const lifecycle = this.store.getOwnedBranchSessionLifecycle(ownerId, branchId);
    const resetPolicy = await this.gateway.getResetPolicy();
    return (
      !resetPolicy.available
      || !resetPolicy.policy
      || !lifecycle
      || sessionWillResetBeforeSend({
        policy: resetPolicy.policy,
        sessionStartedAt: lifecycle.sessionStartedAt,
        lastInteractionAt: lifecycle.lastInteractionAt,
        timeZone: this.gatewayTimezone,
      })
    );
  }

  async submit(
    ownerId: string,
    command: SubmitCanvasSendCommand,
  ): Promise<SubmitCanvasSendResult> {
    const branch = this.store.getOwnedBranch(ownerId, command.branchId);
    if (!branch) throw new CanvasSendApplicationError('not_found', 404, 'Not found');
    const canvas = this.store.getCanvas(ownerId, branch.canvasId);
    if (!canvas) throw new CanvasSendApplicationError('not_found', 404, 'Not found');
    if (canvas.agentId !== command.expectedAgentId) {
      throw new CanvasSendApplicationError('agent_changed', 409);
    }
    const attachments = this.resolveAttachments(ownerId, canvas.id, command.attachmentIds);

    if (branch.sessionState === 'active') {
      await this.refreshSessionIdentity(branch.id, branch.sessionKey);
    }
    const forceSessionRecovery = branch.sessionState === 'active'
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
    if (source.agentId !== command.expectedAgentId) {
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
        expectedAgentId: command.expectedAgentId,
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
        status: error.includes('does not advertise chat.send') ? 503 : 422,
      };
    }
    return { kind: 'operation', operation: result };
  }
}
