import type {
  CanvasDraftInputDocument,
  CanvasDraftInputReference,
  CanvasInputDocument,
  CanvasResourceReferenceMeta,
} from './types';

export const EMPTY_INPUT_DOCUMENT: CanvasDraftInputDocument = {
  version: 1,
  segments: [],
  references: [],
};

export function draftDocumentText(document: CanvasDraftInputDocument): string {
  const references = new Map(document.references.map((reference) => [reference.key, reference]));
  return document.segments.map((segment) => segment.type === 'text'
    ? segment.text
    : `@[${references.get(segment.key)?.name || 'resource'}]`).join('');
}

export function enrichInputDocument(
  document: CanvasInputDocument | undefined,
  metadata: CanvasResourceReferenceMeta[] = [],
  fallbackText = '',
): CanvasDraftInputDocument {
  const source = document || {
    version: 1 as const,
    segments: fallbackText ? [{ type: 'text' as const, text: fallbackText }] : [],
    references: [],
  };
  const metadataByKey = new Map(metadata.map((reference) => [reference.key, reference]));
  return {
    version: 1,
    segments: source.segments,
    references: source.references.map((reference) => ({
      ...reference,
      name: metadataByKey.get(reference.key)?.name,
      mimeType: metadataByKey.get(reference.key)?.mimeType,
    })),
  };
}

export function documentForSend(
  document: CanvasDraftInputDocument,
  attachmentIdByDraftKey: Map<string, string>,
): CanvasInputDocument {
  return {
    version: 1,
    segments: document.segments,
    references: document.references.map((reference) => {
      if (reference.origin === 'draft_attachment') {
        const attachmentId = attachmentIdByDraftKey.get(reference.draftAttachmentKey);
        if (!attachmentId) throw new Error('draft_attachment_unavailable');
        return {
          key: reference.key,
          origin: 'current_turn_attachment' as const,
          attachmentId,
        };
      }
      if (reference.origin === 'current_turn_attachment') {
        return { key: reference.key, origin: reference.origin, attachmentId: reference.attachmentId };
      }
      return {
        key: reference.key,
        origin: reference.origin,
        kind: reference.kind,
        sourceInteractionId: reference.sourceInteractionId,
        resourceId: reference.resourceId,
      };
    }),
  };
}

export function removeDraftResource(
  document: CanvasDraftInputDocument,
  predicate: (reference: CanvasDraftInputReference) => boolean,
): CanvasDraftInputDocument {
  const removedKeys = new Set(document.references.filter(predicate).map((reference) => reference.key));
  if (!removedKeys.size) return document;
  return {
    version: 1,
    segments: document.segments.filter((segment) =>
      segment.type !== 'resource' || !removedKeys.has(segment.key)),
    references: document.references.filter((reference) => !removedKeys.has(reference.key)),
  };
}

export function upstreamReferenceCount(document: CanvasDraftInputDocument): number {
  return document.references.filter((reference) => reference.origin === 'upstream').length;
}
