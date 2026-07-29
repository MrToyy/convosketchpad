import {
  type CanvasArtifact,
  type CanvasAttachment,
  type InteractionRecord,
  type SendReservation,
} from './canvas-db.js';
import {
  canvasArtifactThumbnailUri,
  canvasAttachmentThumbnailUri,
} from './canvas-media-derivatives.js';

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
    ...(attachment.mimeType.startsWith('image/') && canvasMatch
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
    gatewayArtifactId: artifact.gatewayArtifactId,
    name: artifact.name,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    uri: artifact.storage === 'canvas' || artifact.storage === 'external' ? artifact.uri : '',
    ...(artifact.storage === 'canvas' && artifact.mimeType?.startsWith('image/') && canvasMatch
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

export function publicCanvasInteraction(interaction: InteractionRecord): InteractionRecord {
  return {
    ...interaction,
    attachments: interaction.attachments.map(publicCanvasAttachment),
    artifacts: interaction.artifacts.map(publicCanvasArtifact),
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
    sessionKey: operation.sessionKey,
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
