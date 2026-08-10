import type { CanvasAttachment } from '../model.js';
import type { CanvasContextResource } from './send-policy.js';
import type {
  CanvasInputDocument,
  CanvasResourceReferenceSnapshot,
} from './input-document.js';
import {
  buildCanvasReplayPlan,
  canvasReplayResourceIdentity,
  type CanvasReplayReason,
  type CanvasReplaySnapshot,
} from './replay-plan.js';

function singleLineName(name: string): string {
  return name.replace(/[\r\n]+/g, ' ').trim() || 'unnamed file';
}

function escapeCanvasMarkers(text: string): string {
  return text.replaceAll('[[canvas-resource:', '[[canvas-user-text:canvas-resource:');
}

function referenceResource(reference: CanvasResourceReferenceSnapshot): CanvasContextResource {
  return {
    id: `reference:${reference.key}`,
    ...(reference.contentHash ? { contentHash: reference.contentHash } : {}),
    sourceInteractionId: reference.sourceInteractionId || '',
    source: reference.kind === 'canvas_attachment' ? 'user_attachment' : 'agent_artifact',
    name: reference.name,
    mimeType: reference.mimeType,
    sizeBytes: reference.sizeBytes,
    uri: reference.uri,
    available: reference.available,
    ...(reference.warning ? { warning: reference.warning } : {}),
    required: true,
  };
}

function attachmentResource(attachment: CanvasAttachment): CanvasContextResource {
  return {
    id: `current:${attachment.id || attachment.name}`,
    ...(attachment.contentHash ? { contentHash: attachment.contentHash } : {}),
    sourceInteractionId: '',
    source: 'user_attachment',
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    uri: attachment.uri || '',
    available: attachment.available !== false,
    required: true,
  };
}

export function compileCanvasTurnMaterials(input: {
  document: CanvasInputDocument;
  references: CanvasResourceReferenceSnapshot[];
  attachments: CanvasAttachment[];
  replay?: { snapshot: CanvasReplaySnapshot; reason: CanvasReplayReason };
}): {
  message: string;
  bootstrapResources: CanvasContextResource[];
  references: CanvasResourceReferenceSnapshot[];
  attachments: CanvasAttachment[];
} {
  const replay = input.replay
    ? buildCanvasReplayPlan(input.replay.snapshot, input.replay.reason, '')
    : null;
  const physicalByIdentity = new Map<string, CanvasContextResource>();
  for (const resource of replay?.resources || []) {
    physicalByIdentity.set(canvasReplayResourceIdentity(resource), resource);
  }
  const bootstrapResources = [...(replay?.resources || [])];

  const register = (resource: CanvasContextResource, includeInBootstrap: boolean): string => {
    const identity = canvasReplayResourceIdentity(resource);
    const existing = physicalByIdentity.get(identity);
    if (existing) {
      if (resource.required) existing.required = true;
      return existing.replayRef!;
    }
    const replayRef = `F${String(physicalByIdentity.size + 1).padStart(3, '0')}`;
    const physical = { ...resource, replayRef };
    physicalByIdentity.set(identity, physical);
    if (includeInBootstrap) bootstrapResources.push(physical);
    return replayRef;
  };

  const references = input.references.map((reference) => ({
    ...reference,
    deliveryRef: register(referenceResource(reference), reference.origin === 'upstream'),
  }));
  const attachments = input.attachments.map((attachment) => ({
    ...attachment,
    deliveryRef: register(attachmentResource(attachment), false),
  }));
  const referenceByKey = new Map(references.map((reference) => [reference.key, reference]));
  const logicalByKey = new Map<string, string>();
  const rendered = input.document.segments.map((segment) => {
    if (segment.type === 'text') return escapeCanvasMarkers(segment.text);
    let logical = logicalByKey.get(segment.key);
    if (!logical) {
      logical = `R${String(logicalByKey.size + 1).padStart(3, '0')}`;
      logicalByKey.set(segment.key, logical);
    }
    return `[[canvas-resource:${logical}]]`;
  }).join('');
  const manifest = [...logicalByKey].map(([key, logical]) => {
    const reference = referenceByKey.get(key)!;
    return `${logical} -> ${reference.deliveryRef}--${singleLineName(reference.name)}`;
  });
  const referencedCurrentIds = new Set(references.flatMap((reference) =>
    reference.origin === 'current_turn_attachment' ? [reference.resourceId] : []));
  const unreferencedAttachments = attachments.filter((attachment) =>
    attachment.id && !referencedCurrentIds.has(attachment.id));
  if (unreferencedAttachments.length) {
    manifest.push(`Additional current attachments: ${unreferencedAttachments
      .map((attachment) => `${attachment.deliveryRef}--${singleLineName(attachment.name)}`)
      .join(', ')}`);
  }
  const currentMessage = manifest.length
    ? `<canvas-turn-materials>\n${manifest.join('\n')}\n</canvas-turn-materials>\n<canvas-user-input>\n${rendered}\n</canvas-user-input>`
    : rendered;
  return {
    message: replay ? `${replay.message.trimEnd()}\n\n${currentMessage}` : currentMessage,
    bootstrapResources,
    references,
    attachments,
  };
}
