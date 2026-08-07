import type { RuntimeEvent } from '../agent-runtimes/contract.js';

type TextPreviewEvent = Extract<RuntimeEvent, {
  type: 'output.text.delta' | 'output.text.snapshot' | 'output.message.completed';
}>;

interface PreviewSegment {
  id: string;
  text: string;
}

interface InteractionPreview {
  segments: PreviewSegment[];
}

const DEFAULT_SEGMENT_ID = 'default';

/**
 * Converts Runtime text chunks, cumulative snapshots, and completed message
 * items into one cumulative turn preview. The result is safe for stateless SSE
 * clients to replace wholesale on every `node.preview` event.
 */
export class RuntimeTextPreviewAssembler {
  private readonly interactions = new Map<string, InteractionPreview>();

  apply(interactionId: string, event: TextPreviewEvent): string {
    let preview = this.interactions.get(interactionId);
    if (!preview) {
      preview = { segments: [] };
      this.interactions.set(interactionId, preview);
    }
    const segmentId = event.messageId || DEFAULT_SEGMENT_ID;
    let segment = preview.segments.find((candidate) => candidate.id === segmentId);
    if (!segment) {
      segment = { id: segmentId, text: '' };
      preview.segments.push(segment);
    }
    if (event.type === 'output.text.delta') segment.text += event.text;
    else segment.text = event.text;
    return preview.segments.map((candidate) => candidate.text).filter(Boolean).join('\n');
  }

  clear(interactionId: string): void {
    this.interactions.delete(interactionId);
  }

  clearAll(): void {
    this.interactions.clear();
  }
}
