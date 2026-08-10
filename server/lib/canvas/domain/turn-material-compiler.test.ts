import { describe, expect, it } from 'vitest';
import { compileCanvasTurnMaterials } from './turn-material-compiler.js';

describe('Canvas turn material compiler', () => {
  it('preserves inline positions and deduplicates current physical files', () => {
    const attachmentId = 'a'.repeat(40);
    const contentHash = 'b'.repeat(64);
    const result = compileCanvasTurnMaterials({
      document: {
        version: 1,
        segments: [
          { type: 'text', text: 'before ' },
          { type: 'resource', key: 'current' },
          { type: 'text', text: ' after ' },
          { type: 'resource', key: 'current' },
        ],
        references: [{ key: 'current', origin: 'current_turn_attachment', attachmentId }],
      },
      references: [{
        key: 'current', origin: 'current_turn_attachment', kind: 'canvas_attachment',
        sourceInteractionId: null, resourceId: attachmentId, ordinal: 0, name: 'photo.png',
        mimeType: 'image/png', sizeBytes: 10, uri: `/api/canvas/attachments/canvas/${attachmentId}`,
        contentHash, available: true,
      }],
      attachments: [{
        id: attachmentId, contentHash, name: 'photo.png', mimeType: 'image/png', sizeBytes: 10,
        uri: `/api/canvas/attachments/canvas/${attachmentId}`, available: true,
      }],
    });
    expect(result.message).toContain('before [[canvas-resource:R001]] after [[canvas-resource:R001]]');
    expect(result.message).toContain('R001 -> F001--photo.png');
    expect(result.attachments[0].deliveryRef).toBe('F001');
    expect(result.bootstrapResources).toEqual([]);
  });
});
