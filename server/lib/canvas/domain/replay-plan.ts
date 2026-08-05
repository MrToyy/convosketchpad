import { createHash } from 'node:crypto';
import type { CanvasContextResource } from './send-policy.js';

export interface CanvasReplayInteraction {
  id: string;
  user: string;
  assistant: string;
}

export interface CanvasReplaySnapshot {
  interactions: CanvasReplayInteraction[];
  resources: CanvasContextResource[];
}

export interface CanvasReplayPlan {
  message: string;
  resources: CanvasContextResource[];
}

export type CanvasReplayReason = 'canonical-replay' | 'session-recovery';

export function canvasReplayResourceIdentity(resource: CanvasContextResource): string {
  if (resource.contentHash && /^[a-f0-9]{64}$/i.test(resource.contentHash)) {
    return `content:${resource.contentHash.toLowerCase()}`;
  }
  const canvasPath = resource.uri.match(/^\/api\/canvas\/(?:attachments|artifacts)\/.+\/([a-f0-9]{40})$/i);
  if (canvasPath) return `legacy:${canvasPath[1].toLowerCase()}`;
  if (resource.uri.startsWith('data:')) {
    return `data:${createHash('sha256').update(resource.uri).digest('hex')}`;
  }
  return `uri:${resource.uri}`;
}

export function canvasReplayResourceFileName(resource: CanvasContextResource): string {
  const prefix = resource.replayRef ? `${resource.replayRef}--` : '';
  return `${prefix}${resource.name}`;
}

function resourceLine(label: string, entries: Array<{ replayRef: string; name: string }>): string {
  return `${label}: ${entries.map((entry) => `${entry.replayRef} — ${singleLineName(entry.name)}`).join(', ')}`;
}

function singleLineName(name: string): string {
  return name.replace(/[\r\n]+/g, ' ').trim() || 'unnamed file';
}

export function buildCanvasReplayPlan(
  snapshot: CanvasReplaySnapshot,
  reason: CanvasReplayReason,
  userInput: string,
): CanvasReplayPlan {
  const physicalByIdentity = new Map<string, CanvasContextResource>();
  const referencesByInteraction = new Map<string, {
    attachments: Array<{ replayRef: string; name: string }>;
    artifacts: Array<{ replayRef: string; name: string }>;
  }>();

  for (const resource of snapshot.resources) {
    if (!resource.available) continue;
    const identity = canvasReplayResourceIdentity(resource);
    let physical = physicalByIdentity.get(identity);
    if (!physical) {
      const replayRef = `F${String(physicalByIdentity.size + 1).padStart(3, '0')}`;
      physical = { ...resource, replayRef };
      physicalByIdentity.set(identity, physical);
    }
    const references = referencesByInteraction.get(resource.sourceInteractionId)
      || { attachments: [], artifacts: [] };
    const target = resource.source === 'user_attachment'
      ? references.attachments
      : references.artifacts;
    target.push({ replayRef: physical.replayRef!, name: resource.name });
    referencesByInteraction.set(resource.sourceInteractionId, references);
  }

  const transcript = snapshot.interactions.map((interaction, index) => {
    const references = referencesByInteraction.get(interaction.id);
    return [
      `Interaction ${index + 1}`,
      `User: ${interaction.user}`,
      ...(references?.attachments.length
        ? [resourceLine('User attachments', references.attachments)]
        : []),
      `Agent: ${interaction.assistant}`,
      ...(references?.artifacts.length
        ? [resourceLine('Agent artifacts', references.artifacts)]
        : []),
    ].join('\n');
  }).join('\n\n');

  const reasonText = reason === 'canonical-replay'
    ? 'The user forked an earlier Canvas interaction. Continue from this complete immutable prior context.'
    : 'The Agent Runtime replaced or reset this Canvas conversation. Restore this complete immutable branch context before continuing.';
  const resources = [...physicalByIdentity.values()];
  const resourceNote = resources.length > 0
    ? '\n\nRestored files are attached through the Agent Runtime in F001, F002, ... order. F references in the history identify their original interaction and role.'
    : '';
  return {
    message: `<canvas-context-snapshot>\n${reasonText}\n\n${transcript}${resourceNote}\n</canvas-context-snapshot>\n\n${userInput}`,
    resources,
  };
}
