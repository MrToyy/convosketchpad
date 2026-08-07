import {
  type CanvasArtifact,
  type CanvasAttachment,
  type InteractionRecord,
  type SendReservation,
} from './canvas/model.js';
import {
  canvasArtifactThumbnailUri,
  canvasAttachmentThumbnailUri,
} from './canvas-media-derivatives.js';

const SAFE_RASTER_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function hasSafeRasterPreview(mimeType?: string): boolean {
  return SAFE_RASTER_IMAGE_MIME_TYPES.has(mimeType?.toLowerCase() || '');
}

export function publicCanvasAttachment(attachment: CanvasAttachment): CanvasAttachment {
  const canvasMatch = attachment.uri?.match(/^\/api\/canvas\/attachments\/([^/]+)\/([^/]+)$/);
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    uri: attachment.storage === 'canvas' && attachment.uri?.startsWith('/api/canvas/')
      ? attachment.uri
      : undefined,
    ...(hasSafeRasterPreview(attachment.mimeType) && canvasMatch
      ? {
        thumbnailUri: canvasAttachmentThumbnailUri(
          decodeURIComponent(canvasMatch[1]),
          decodeURIComponent(canvasMatch[2]),
        ),
      }
      : {}),
    storage: attachment.storage,
    available: attachment.available,
    warning: attachment.warning,
  };
}

export function publicCanvasArtifact(artifact: CanvasArtifact): CanvasArtifact {
  const canvasMatch = artifact.uri.match(/^\/api\/canvas\/artifacts\/([^/]+)\/([^/]+)\/([^/]+)$/);
  return {
    id: artifact.id,
    name: artifact.name,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    uri: artifact.storage === 'canvas' || artifact.storage === 'external' ? artifact.uri : '',
    ...(artifact.storage === 'canvas' && hasSafeRasterPreview(artifact.mimeType) && canvasMatch
      ? {
        thumbnailUri: canvasArtifactThumbnailUri(
          decodeURIComponent(canvasMatch[1]),
          decodeURIComponent(canvasMatch[2]),
          decodeURIComponent(canvasMatch[3]),
        ),
      }
      : {}),
    storage: artifact.storage,
    available: artifact.available,
    warning: artifact.warning,
  };
}

export function publicCanvasInteraction(interaction: InteractionRecord) {
  return {
    id: interaction.id,
    version: interaction.version,
    branchId: interaction.branchId,
    parentInteractionId: interaction.parentInteractionId,
    userInput: interaction.userInput,
    agentOutput: interaction.agentOutput,
    status: interaction.status,
    executionState: interaction.executionState,
    artifactSyncState: interaction.artifactSyncState,
    terminalAt: interaction.terminalAt,
    error: interaction.error,
    attachments: interaction.attachments.map(publicCanvasAttachment),
    artifacts: interaction.artifacts.map(publicCanvasArtifact),
    approvals: interaction.approvals.map((approval) => ({
      id: approval.id,
      category: approval.category,
      title: approval.title,
      description: approval.description,
      risk: approval.risk,
      permissions: approval.permissions,
      choices: approval.choices,
      expiresAt: approval.expiresAt,
      status: approval.status,
      resolution: approval.resolution,
      resolvedBy: approval.resolvedBy,
      resolvedAt: approval.resolvedAt,
      error: approval.error,
      createdAt: approval.createdAt,
      updatedAt: approval.updatedAt,
    })),
    executionMetadata: interaction.executionMetadata,
    contextSnapshot: interaction.contextSnapshot ? {
      usedTokens: interaction.contextSnapshot.usedTokens,
      contextLimit: interaction.contextSnapshot.contextLimit,
      runtimeId: interaction.contextSnapshot.runtimeId,
      conversationInstanceId: interaction.contextSnapshot.conversationInstanceId,
      ...(interaction.contextSnapshot.model ? { model: interaction.contextSnapshot.model } : {}),
      ...(interaction.contextSnapshot.provider ? { provider: interaction.contextSnapshot.provider } : {}),
      ...(interaction.contextSnapshot.compactionCount === undefined
        ? {}
        : { compactionCount: interaction.contextSnapshot.compactionCount }),
      capturedAt: interaction.contextSnapshot.capturedAt,
      source: interaction.contextSnapshot.source,
    } : null,
    createdAt: interaction.createdAt,
    updatedAt: interaction.updatedAt,
  };
}

export function publicCanvasSendReservation(operation: SendReservation) {
  return {
    id: operation.id,
    branchId: operation.branchId,
    expectedHeadInteractionId: operation.expectedHeadInteractionId,
    userInput: operation.userInput,
    attachments: operation.attachments.map(publicCanvasAttachment),
    materialization: operation.materialization,
    conversationId: operation.conversationId,
    ...(operation.snapshotVersion === undefined ? {} : { snapshotVersion: operation.snapshotVersion }),
    status: operation.status,
    dispatchState: operation.dispatchState,
    attemptCount: operation.attemptCount,
    lastAttemptAt: operation.lastAttemptAt,
    nextAttemptAt: operation.nextAttemptAt,
    error: operation.error,
    interactionId: operation.interactionId,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
  };
}
