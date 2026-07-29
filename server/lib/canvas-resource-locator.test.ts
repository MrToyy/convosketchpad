import { describe, expect, it } from 'vitest';
import { locateCanvasResource } from './canvas-resource-locator.js';

describe('Canvas resource locator', () => {
  it('maps current public resource URIs to typed internal locators', () => {
    expect(locateCanvasResource('/api/canvas/attachments/canvas-1/attachment-1')).toEqual({
      kind: 'canvas_attachment',
      canvasId: 'canvas-1',
      attachmentId: 'attachment-1',
    });
    expect(locateCanvasResource('/api/canvas/artifacts/canvas-1/interaction-1/artifact-1')).toEqual({
      kind: 'interaction_artifact',
      canvasId: 'canvas-1',
      interactionId: 'interaction-1',
      artifactId: 'artifact-1',
    });
  });

  it('supports legacy inline data without treating arbitrary external URIs as local files', () => {
    expect(locateCanvasResource('data:image/png;base64,YQ==')).toEqual({
      kind: 'inline_data',
      encoded: 'YQ==',
    });
    expect(locateCanvasResource('https://example.com/file.png')).toBeNull();
  });
});
