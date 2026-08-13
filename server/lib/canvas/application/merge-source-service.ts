import type { CanvasStore } from '../persistence/canvas-store.js';
import type { MergeSourceRecord } from '../model.js';

export class CanvasMergeSourceService {
  private readonly store: CanvasStore;

  constructor(store: CanvasStore) {
    this.store = store;
  }

  connect(input: {
    ownerId: string;
    targetBranchId: string;
    expectedHeadInteractionId: string | null;
    sourceInteractionId: string;
  }): { mergeSource: MergeSourceRecord; created: boolean; canvasId: string } {
    return this.store.createMergeSource(
      input.ownerId,
      input.targetBranchId,
      input.expectedHeadInteractionId,
      input.sourceInteractionId,
    );
  }
}
