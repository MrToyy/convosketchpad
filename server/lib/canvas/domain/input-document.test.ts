import { describe, expect, it } from 'vitest';
import {
  MAX_USER_INPUT_CHARACTERS,
  canvasInputDocumentText,
  normalizeCanvasInputDocument,
} from './input-document.js';

describe('Canvas input documents', () => {
  it('normalizes text while preserving repeated resource positions', () => {
    const document = normalizeCanvasInputDocument({
      version: 1,
      segments: [
        { type: 'text', text: 'compare ' },
        { type: 'text', text: 'this ' },
        { type: 'resource', key: 'resource-a' },
        { type: 'text', text: ' with ' },
        { type: 'resource', key: 'resource-a' },
      ],
      references: [{
        key: 'resource-a',
        origin: 'current_turn_attachment',
        attachmentId: 'a'.repeat(40),
      }],
    });
    expect(document.segments).toEqual([
      { type: 'text', text: 'compare this ' },
      { type: 'resource', key: 'resource-a' },
      { type: 'text', text: ' with ' },
      { type: 'resource', key: 'resource-a' },
    ]);
    expect(canvasInputDocumentText(document, [{
      key: 'resource-a',
      origin: 'current_turn_attachment',
      kind: 'canvas_attachment',
      sourceInteractionId: null,
      resourceId: 'a'.repeat(40),
      ordinal: 0,
      name: 'brief.pdf',
      mimeType: 'application/pdf',
      uri: '/api/canvas/attachments/canvas/a',
      available: true,
    }])).toBe('compare this @[brief.pdf] with @[brief.pdf]');
  });

  it('rejects duplicate logical locators and oversized text', () => {
    expect(() => normalizeCanvasInputDocument({
      version: 1,
      segments: [{ type: 'resource', key: 'a' }, { type: 'resource', key: 'b' }],
      references: [
        { key: 'a', origin: 'current_turn_attachment', attachmentId: 'a'.repeat(40) },
        { key: 'b', origin: 'current_turn_attachment', attachmentId: 'a'.repeat(40) },
      ],
    })).toThrow('duplicate_resource_reference');
    expect(() => normalizeCanvasInputDocument({
      version: 1,
      segments: [{ type: 'text', text: 'x'.repeat(MAX_USER_INPUT_CHARACTERS + 1) }],
      references: [],
    })).toThrow('input_document_too_large');
  });
});
