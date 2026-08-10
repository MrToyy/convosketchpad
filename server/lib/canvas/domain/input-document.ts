export const MAX_TURN_MATERIALS = 9;
export const MAX_INPUT_DOCUMENT_SEGMENTS = 2_000;
export const MAX_USER_INPUT_CHARACTERS = 500_000;

export type CanvasInputSegment =
  | { type: 'text'; text: string }
  | { type: 'resource'; key: string };

export type CanvasInputReference =
  | {
    key: string;
    origin: 'current_turn_attachment';
    attachmentId: string;
  }
  | {
    key: string;
    origin: 'upstream';
    kind: 'canvas_attachment' | 'interaction_artifact';
    sourceInteractionId: string;
    resourceId: string;
  };

export interface CanvasInputDocument {
  version: 1;
  segments: CanvasInputSegment[];
  references: CanvasInputReference[];
}

export interface CanvasResourceReferenceSnapshot {
  key: string;
  origin: CanvasInputReference['origin'];
  kind: 'canvas_attachment' | 'interaction_artifact';
  sourceInteractionId: string | null;
  resourceId: string;
  ordinal: number;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  uri: string;
  thumbnailUri?: string;
  available: boolean;
  warning?: string;
  contentHash?: string;
  deliveryRef?: string;
}

export function textInputDocument(text: string): CanvasInputDocument {
  return {
    version: 1,
    segments: text ? [{ type: 'text', text }] : [],
    references: [],
  };
}

function referenceIdentity(reference: CanvasInputReference): string {
  return reference.origin === 'current_turn_attachment'
    ? `current:${reference.attachmentId}`
    : `upstream:${reference.sourceInteractionId}:${reference.kind}:${reference.resourceId}`;
}

export function normalizeCanvasInputDocument(document: CanvasInputDocument): CanvasInputDocument {
  if (document.version !== 1) throw new Error('invalid_input_document');
  if (document.segments.length > MAX_INPUT_DOCUMENT_SEGMENTS) {
    throw new Error('input_document_too_complex');
  }

  const referencesByKey = new Map<string, CanvasInputReference>();
  const identities = new Set<string>();
  for (const reference of document.references) {
    if (!reference.key || referencesByKey.has(reference.key)) throw new Error('invalid_resource_reference');
    const identity = referenceIdentity(reference);
    if (identities.has(identity)) throw new Error('duplicate_resource_reference');
    identities.add(identity);
    referencesByKey.set(reference.key, reference);
  }

  const usedKeys = new Set<string>();
  const segments: CanvasInputSegment[] = [];
  let characterCount = 0;
  for (const segment of document.segments) {
    if (segment.type === 'text') {
      if (!segment.text) continue;
      characterCount += segment.text.length;
      if (characterCount > MAX_USER_INPUT_CHARACTERS) throw new Error('input_document_too_large');
      const previous = segments.at(-1);
      if (previous?.type === 'text') previous.text += segment.text;
      else segments.push({ type: 'text', text: segment.text });
      continue;
    }
    if (!referencesByKey.has(segment.key)) throw new Error('invalid_resource_reference');
    usedKeys.add(segment.key);
    segments.push({ type: 'resource', key: segment.key });
  }

  const references = document.references.filter((reference) => usedKeys.has(reference.key));
  return { version: 1, segments, references };
}

export function canvasInputDocumentText(
  document: CanvasInputDocument,
  snapshots: CanvasResourceReferenceSnapshot[] = [],
): string {
  const names = new Map(snapshots.map((snapshot) => [snapshot.key, snapshot.name]));
  return document.segments.map((segment) => segment.type === 'text'
    ? segment.text
    : `@[${names.get(segment.key) || 'resource'}]`).join('');
}

export function canvasInputDocumentHasContent(document: CanvasInputDocument): boolean {
  return document.segments.some((segment) => segment.type === 'resource'
    || (segment.type === 'text' && Boolean(segment.text.trim())));
}

export function canvasInputReferenceIdentity(reference: CanvasInputReference): string {
  return referenceIdentity(reference);
}
