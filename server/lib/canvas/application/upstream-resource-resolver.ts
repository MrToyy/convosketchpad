import type { CanvasStore } from '../persistence/canvas-store.js';
import type { CanvasAttachment, CanvasArtifact, InteractionRecord } from '../model.js';
import {
  MAX_TURN_MATERIALS,
  canvasInputDocumentText,
  canvasInputReferenceIdentity,
  normalizeCanvasInputDocument,
  type CanvasInputDocument,
  type CanvasInputReference,
  type CanvasResourceReferenceSnapshot,
} from '../domain/input-document.js';
import { CanvasApplicationError } from './errors.js';

export interface UpstreamResourceCatalogItem {
  reference: Extract<CanvasInputReference, { origin: 'upstream' }>;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  uri: string;
  contentHash?: string;
  available: boolean;
  warning?: string;
  sourceCreatedAt: number;
}

function attachmentItem(
  interaction: InteractionRecord,
  attachment: CanvasAttachment,
): UpstreamResourceCatalogItem | null {
  if (
    !attachment.id
    || attachment.storage !== 'canvas'
    || !attachment.uri?.startsWith('/api/canvas/attachments/')
  ) return null;
  return {
    reference: {
      key: '',
      origin: 'upstream',
      kind: 'canvas_attachment',
      sourceInteractionId: interaction.id,
      resourceId: attachment.id,
    },
    name: attachment.name,
    mimeType: attachment.mimeType || 'application/octet-stream',
    sizeBytes: attachment.sizeBytes,
    uri: attachment.uri,
    ...(attachment.contentHash ? { contentHash: attachment.contentHash } : {}),
    available: attachment.available !== false,
    ...(attachment.warning ? { warning: attachment.warning } : {}),
    sourceCreatedAt: interaction.createdAt,
  };
}

function artifactItem(
  interaction: InteractionRecord,
  artifact: CanvasArtifact,
): UpstreamResourceCatalogItem | null {
  if (
    !artifact.id
    || artifact.storage !== 'canvas'
    || !artifact.uri.startsWith('/api/canvas/artifacts/')
  ) return null;
  return {
    reference: {
      key: '',
      origin: 'upstream',
      kind: 'interaction_artifact',
      sourceInteractionId: interaction.id,
      resourceId: artifact.id,
    },
    name: artifact.name,
    mimeType: artifact.mimeType || 'application/octet-stream',
    ...(artifact.sizeBytes === undefined ? {} : { sizeBytes: artifact.sizeBytes }),
    uri: artifact.uri,
    ...(artifact.contentHash ? { contentHash: artifact.contentHash } : {}),
    available: artifact.available !== false,
    ...(artifact.warning ? { warning: artifact.warning } : {}),
    sourceCreatedAt: interaction.createdAt,
  };
}

export class UpstreamResourceResolver {
  private readonly store: CanvasStore;

  constructor(store: CanvasStore) {
    this.store = store;
  }

  listInteractions(ownerId: string, branchId: string): InteractionRecord[] {
    const branch = this.store.getOwnedBranch(ownerId, branchId);
    if (!branch) throw new CanvasApplicationError('not_found', 404, 'Not found');
    let cursor = branch.headInteractionId || branch.forkedFromInteractionId;
    const seen = new Set<string>();
    const interactions: InteractionRecord[] = [];
    while (cursor) {
      if (seen.has(cursor)) throw new CanvasApplicationError('invalid_upstream_graph', 409);
      seen.add(cursor);
      const interaction = this.store.getOwnedInteraction(ownerId, cursor);
      if (!interaction || interaction.canvasId !== branch.canvasId) {
        throw new CanvasApplicationError('invalid_upstream_graph', 409);
      }
      interactions.push(interaction);
      cursor = interaction.parentInteractionId;
    }
    return interactions;
  }

  listResources(ownerId: string, branchId: string): UpstreamResourceCatalogItem[] {
    return this.listInteractions(ownerId, branchId).flatMap((interaction) => [
      ...interaction.attachments.flatMap((attachment) => {
        const item = attachmentItem(interaction, attachment);
        return item ? [item] : [];
      }),
      ...interaction.artifacts.flatMap((artifact) => {
        const item = artifactItem(interaction, artifact);
        return item ? [item] : [];
      }),
    ]);
  }

  resolveDocument(input: {
    ownerId: string;
    branchId: string;
    document: CanvasInputDocument;
    currentAttachments: CanvasAttachment[];
  }): {
    document: CanvasInputDocument;
    userInput: string;
    references: CanvasResourceReferenceSnapshot[];
  } {
    const document = normalizeCanvasInputDocument(input.document);
    const currentById = new Map(input.currentAttachments.flatMap((attachment) =>
      attachment.id ? [[attachment.id, attachment] as const] : []));
    const upstreamByIdentity = new Map(this.listResources(input.ownerId, input.branchId).map((item) => [
      canvasInputReferenceIdentity(item.reference),
      item,
    ]));
    const firstOrdinal = new Map<string, number>();
    for (const segment of document.segments) {
      if (segment.type === 'resource' && !firstOrdinal.has(segment.key)) {
        firstOrdinal.set(segment.key, firstOrdinal.size);
      }
    }

    const references = document.references.map((reference): CanvasResourceReferenceSnapshot => {
      const ordinal = firstOrdinal.get(reference.key);
      if (ordinal === undefined) throw new CanvasApplicationError('invalid_resource_reference', 422);
      if (reference.origin === 'current_turn_attachment') {
        const attachment = currentById.get(reference.attachmentId);
        if (!attachment?.id || !attachment.uri) {
          throw new CanvasApplicationError('resource_reference_unavailable', 422);
        }
        return {
          key: reference.key,
          origin: reference.origin,
          kind: 'canvas_attachment',
          sourceInteractionId: null,
          resourceId: attachment.id,
          ordinal,
          name: attachment.name,
          mimeType: attachment.mimeType || 'application/octet-stream',
          sizeBytes: attachment.sizeBytes,
          uri: attachment.uri,
          available: attachment.available !== false,
          ...(attachment.warning ? { warning: attachment.warning } : {}),
          ...(attachment.contentHash ? { contentHash: attachment.contentHash } : {}),
        };
      }
      const item = upstreamByIdentity.get(canvasInputReferenceIdentity(reference));
      if (!item?.available) {
        throw new CanvasApplicationError('resource_reference_unavailable', 422);
      }
      return {
        key: reference.key,
        origin: reference.origin,
        kind: reference.kind,
        sourceInteractionId: reference.sourceInteractionId,
        resourceId: reference.resourceId,
        ordinal,
        name: item.name,
        mimeType: item.mimeType,
        ...(item.sizeBytes === undefined ? {} : { sizeBytes: item.sizeBytes }),
        uri: item.uri,
        available: true,
        ...(item.warning ? { warning: item.warning } : {}),
        ...(item.contentHash ? { contentHash: item.contentHash } : {}),
      };
    });

    const upstreamCount = references.filter((reference) => reference.origin === 'upstream').length;
    if (currentById.size + upstreamCount > MAX_TURN_MATERIALS) {
      throw new CanvasApplicationError('turn_material_limit_exceeded', 422);
    }
    return {
      document,
      userInput: canvasInputDocumentText(document, references),
      references,
    };
  }
}
