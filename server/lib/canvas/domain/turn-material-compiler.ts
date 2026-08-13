import type { CanvasAttachment } from '../model.js';
import type { CanvasContextResource } from './send-policy.js';
import type {
  CanvasInputDocument,
  CanvasResourceReferenceSnapshot,
} from './input-document.js';
import type { MergeContextSnapshot } from './merge-context.js';
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
  merge?: MergeContextSnapshot;
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

  for (const resource of input.merge?.resources || []) register(resource, true);
  let logicalCounter = 0;
  const mergeMessage = input.merge ? (() => {
    const resourcesByInteraction = new Map<string, CanvasContextResource[]>();
    for (const resource of input.merge!.resources) {
      const current = resourcesByInteraction.get(resource.sourceInteractionId) || [];
      current.push(resource);
      resourcesByInteraction.set(resource.sourceInteractionId, current);
    }
    const interactions = input.merge!.interactions.map((interaction) => {
      const referenceByKey = new Map((interaction.resourceReferences || []).map((reference) => [
        reference.key,
        reference,
      ]));
      const referenceLines: string[] = [];
      const logicalByKey = new Map<string, string>();
      const user = interaction.inputDocument
        ? interaction.inputDocument.segments.map((segment) => {
          if (segment.type === 'text') return escapeCanvasMarkers(segment.text);
          let logical = logicalByKey.get(segment.key);
          if (!logical) {
            logicalCounter += 1;
            logical = `R${String(logicalCounter).padStart(3, '0')}`;
            logicalByKey.set(segment.key, logical);
          }
          const reference = referenceByKey.get(segment.key);
          if (reference) {
            const physical = physicalByIdentity.get(canvasReplayResourceIdentity({
              id: `merge-reference:${reference.key}`,
              ...(reference.contentHash ? { contentHash: reference.contentHash } : {}),
              sourceInteractionId: reference.sourceInteractionId || interaction.id,
              source: reference.kind === 'canvas_attachment' ? 'user_attachment' : 'agent_artifact',
              name: reference.name,
              mimeType: reference.mimeType,
              sizeBytes: reference.sizeBytes,
              uri: reference.uri,
              available: reference.available,
            }));
            if (physical?.replayRef) {
              referenceLines.push(`${logical} -> ${physical.replayRef}--${singleLineName(reference.name)}`);
            }
          }
          return `[[canvas-resource:${logical}]]`;
        }).join('')
        : escapeCanvasMarkers(interaction.user);
      const resources = resourcesByInteraction.get(interaction.id) || [];
      const attachments = resources.filter((resource) => resource.source === 'user_attachment');
      const artifacts = resources.filter((resource) => resource.source === 'agent_artifact');
      const resourceLine = (label: string, values: CanvasContextResource[]) => values.length
        ? [`${label}: ${values.map((resource) => {
          const physical = physicalByIdentity.get(canvasReplayResourceIdentity(resource));
          return `${physical?.replayRef || '?'} — ${singleLineName(resource.name)}`;
        }).join(', ')}`]
        : [];
      return [
        interaction.marker,
        `User: ${user}`,
        ...(referenceLines.length ? [`User resource positions: ${referenceLines.join(', ')}`] : []),
        ...resourceLine('User attachments', attachments),
        `Agent: ${interaction.assistant}`,
        ...resourceLine('Agent artifacts', artifacts),
      ].join('\n');
    });
    const sources = input.merge!.sources.map((source, index) =>
      `S${String(index + 1).padStart(3, '0')}: ${source.path.map((item) => item.marker).join(' -> ') || '(no additional context)'}`);
    return `<canvas-merge-context>\nThe user connected these complete immutable Canvas paths. B markers are already resident in the target conversation; C markers are the deduplicated context added now.\n\n${sources.join('\n')}\n\n${interactions.join('\n\n')}\n</canvas-merge-context>`;
  })() : '';

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
      logicalCounter += 1;
      logical = `R${String(logicalCounter).padStart(3, '0')}`;
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
    message: [replay?.message.trimEnd(), mergeMessage, currentMessage].filter(Boolean).join('\n\n'),
    bootstrapResources,
    references,
    attachments,
  };
}
