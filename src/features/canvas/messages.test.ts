import { describe, expect, it } from 'vitest';
import { CanvasLocalizedError, canvasCopy, canvasErrorMessage, getCanvasCopy } from './messages';

describe('Canvas localized copy', () => {
  it('keeps the locale dictionaries structurally aligned', () => {
    expect(Object.keys(canvasCopy.en).sort()).toEqual(Object.keys(canvasCopy['zh-CN']).sort());
    expect(Object.keys(canvasCopy.en.status).sort()).toEqual(Object.keys(canvasCopy['zh-CN'].status).sort());
  });

  it('formats locale-specific default names and interpolated labels', () => {
    expect(getCanvasCopy('zh-CN').defaultCanvasName(2)).toBe('画布 2');
    expect(getCanvasCopy('en').defaultCanvasName(2)).toBe('Canvas 2');
    expect(getCanvasCopy('en').previewImage('result.png')).toBe('Preview image result.png');
  });

  it('translates known server errors and hides unknown cross-language messages', () => {
    expect(canvasErrorMessage(new Error('send_in_progress'), 'fallback', 'en')).toContain('already');
    expect(canvasErrorMessage(new Error('未知错误'), 'English fallback', 'en')).toBe('English fallback');
    expect(canvasErrorMessage(new Error('未知错误'), '中文回退', 'zh-CN')).toBe('未知错误');
  });

  it('preserves frontend messages that are already localized', () => {
    expect(canvasErrorMessage(new CanvasLocalizedError('Attachment is too large'), 'fallback', 'en')).toBe('Attachment is too large');
  });
});
