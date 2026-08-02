import { readCanvasArtifact, readCanvasAttachment } from './canvas-artifact-store.js';
import {
  getCanvasStore,
  type DispatchableSendReservation,
} from './canvas-db.js';
import type { CanvasContextResource } from './canvas-domain.js';
import {
  CANVAS_DELIVERY_MAX_BYTES,
  ensureCanvasMediaDerivative,
} from './canvas-media-derivatives.js';
import { canvasReplayResourceFileName } from './canvas-replay-plan.js';
import { locateCanvasResource } from './canvas-resource-locator.js';

export interface BackendDeliveryAttachment {
  fileName: string;
  mimeType: string;
  content: string;
}

async function loadContextResource(
  reservation: DispatchableSendReservation,
  resource: CanvasContextResource,
): Promise<BackendDeliveryAttachment> {
  const store = getCanvasStore();
  const locator = locateCanvasResource(resource.uri);
  let bytes: Uint8Array | null = null;
  let recordContentHash: ((contentHash: string) => void) | undefined;
  if (locator?.kind === 'canvas_attachment') {
    if (locator.canvasId === reservation.canvasId) {
      recordContentHash = (contentHash) => {
        store.setCanvasAttachmentContentHash(
          reservation.ownerId,
          reservation.canvasId,
          locator.attachmentId,
          contentHash,
        );
      };
    }
  } else if (locator?.kind === 'interaction_artifact') {
    const interaction = store.getOwnedInteraction(reservation.ownerId, resource.sourceInteractionId);
    if (interaction) {
      recordContentHash = (contentHash) => {
        store.setInteractionArtifactContentHash(
          reservation.ownerId,
          interaction.id,
          locator.artifactId,
          contentHash,
        );
      };
    }
  }
  const loadBytes = async () => {
    if (bytes) return bytes;
    if (locator?.kind === 'canvas_attachment') {
      if (locator.canvasId === reservation.canvasId) {
        bytes = await readCanvasAttachment(
          reservation.ownerId,
          reservation.canvasId,
          locator.attachmentId,
        );
      }
    } else if (locator?.kind === 'interaction_artifact') {
      const interaction = store.getOwnedInteraction(reservation.ownerId, resource.sourceInteractionId);
      if (interaction) {
        bytes = (await readCanvasArtifact(interaction, locator.artifactId))?.bytes || null;
      }
    } else if (locator?.kind === 'inline_data') {
      bytes = Buffer.from(locator.encoded, 'base64');
    }
    return bytes;
  };

  if (
    resource.mimeType.startsWith('image/')
    && (resource.sizeBytes || 0) > CANVAS_DELIVERY_MAX_BYTES
  ) {
    const prepared = await ensureCanvasMediaDerivative(store, {
      ownerId: reservation.ownerId,
      canvasId: reservation.canvasId,
      name: resource.name,
      mimeType: resource.mimeType,
      contentHash: resource.contentHash,
      loadBytes,
      recordContentHash,
    }, 'delivery');
    return {
      fileName: canvasReplayResourceFileName(resource),
      mimeType: prepared.derivative.mimeType,
      content: Buffer.from(prepared.bytes).toString('base64'),
    };
  }
  bytes = await loadBytes();
  if (!bytes) throw new Error('resource_unavailable');
  if (resource.mimeType.startsWith('image/') && bytes.byteLength > CANVAS_DELIVERY_MAX_BYTES) {
    const prepared = await ensureCanvasMediaDerivative(store, {
      ownerId: reservation.ownerId,
      canvasId: reservation.canvasId,
      name: resource.name,
      mimeType: resource.mimeType,
      contentHash: resource.contentHash,
      loadBytes: async () => bytes,
      recordContentHash,
    }, 'delivery');
    return {
      fileName: canvasReplayResourceFileName(resource),
      mimeType: prepared.derivative.mimeType,
      content: Buffer.from(prepared.bytes).toString('base64'),
    };
  }
  return {
    fileName: canvasReplayResourceFileName(resource),
    mimeType: resource.mimeType || 'application/octet-stream',
    content: Buffer.from(bytes).toString('base64'),
  };
}

export async function buildCanvasDelivery(
  reservation: DispatchableSendReservation,
): Promise<{
  message: string;
  attachments: BackendDeliveryAttachment[];
  bootstrapWarnings: string[];
}> {
  const store = getCanvasStore();
  const attachments: BackendDeliveryAttachment[] = [];
  const bootstrapWarnings: string[] = [];
  for (const resource of reservation.bootstrapResources) {
    try {
      attachments.push(await loadContextResource(reservation, resource));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!['resource_unavailable', 'media_source_unavailable'].includes(message)) throw error;
      bootstrapWarnings.push(`${resource.name}: resource unavailable`);
    }
  }
  for (const attachment of reservation.attachments) {
    if (!attachment.id) throw new Error('attachment_not_found');
    const originalBytes = await readCanvasAttachment(
      reservation.ownerId,
      reservation.canvasId,
      attachment.id,
    );
    if (!originalBytes) throw new Error('attachment_unavailable');
    const prepared = attachment.mimeType.startsWith('image/')
      && originalBytes.byteLength > CANVAS_DELIVERY_MAX_BYTES
      ? await ensureCanvasMediaDerivative(store, {
        ownerId: reservation.ownerId,
        canvasId: reservation.canvasId,
        name: attachment.name,
        mimeType: attachment.mimeType,
        contentHash: attachment.contentHash,
        loadBytes: async () => originalBytes,
        recordContentHash: (contentHash) => {
          store.setCanvasAttachmentContentHash(
            reservation.ownerId,
            reservation.canvasId,
            attachment.id!,
            contentHash,
          );
        },
      }, 'delivery')
      : null;
    const bytes = prepared?.bytes || originalBytes;
    attachments.push({
      fileName: attachment.name,
      mimeType: prepared?.derivative.mimeType || attachment.mimeType,
      content: Buffer.from(bytes).toString('base64'),
    });
  }
  let message = reservation.outgoingMessage;
  if (bootstrapWarnings.length) {
    message += `\n\nCanvas replay note: Some restored files could not be attached: ${bootstrapWarnings.join('; ')}`;
  }
  return { message, attachments, bootstrapWarnings };
}
