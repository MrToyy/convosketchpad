import {
  type BranchRecord,
  type CanvasStore,
} from './canvas-db.js';

export class CanvasBranchService {
  private readonly store: CanvasStore;

  constructor(store: CanvasStore) {
    this.store = store;
  }

  createRoot(ownerId: string, canvasId: string): BranchRecord {
    return this.store.createRootBranch(ownerId, canvasId);
  }

  fork(ownerId: string, interactionId: string): BranchRecord {
    return this.store.forkInteraction(ownerId, interactionId);
  }
}
