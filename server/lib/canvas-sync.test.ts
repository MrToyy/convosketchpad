import { describe, expect, it, vi } from 'vitest';
import {
  publishCanvasChanged,
  publishCanvasPreview,
  subscribeCanvasSync,
} from './canvas-sync.js';

describe('Canvas sync notifications', () => {
  it('separates durable change wakeups from non-replayable previews', () => {
    const subscriber = vi.fn();
    const unsubscribe = subscribeCanvasSync(subscriber);

    publishCanvasChanged('owner-1', 'canvas-1');
    publishCanvasPreview({
      ownerId: 'owner-1',
      canvasId: 'canvas-1',
      interactionId: 'interaction-1',
      text: 'partial',
    });

    expect(subscriber).toHaveBeenNthCalledWith(1, {
      kind: 'changed',
      ownerId: 'owner-1',
      canvasId: 'canvas-1',
    });
    expect(subscriber).toHaveBeenNthCalledWith(2, {
      kind: 'preview',
      ownerId: 'owner-1',
      canvasId: 'canvas-1',
      interactionId: 'interaction-1',
      text: 'partial',
    });
    unsubscribe();
  });
});
