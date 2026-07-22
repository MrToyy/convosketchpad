import { describe, expect, it } from 'vitest';
import { DEFAULT_LANGUAGE, normalizeLanguage } from './language';

describe('language preference', () => {
  it('accepts supported languages', () => {
    expect(normalizeLanguage('zh-CN')).toBe('zh-CN');
    expect(normalizeLanguage('en')).toBe('en');
  });

  it('falls back to Simplified Chinese for missing or unsupported values', () => {
    expect(normalizeLanguage(null)).toBe(DEFAULT_LANGUAGE);
    expect(normalizeLanguage('fr')).toBe(DEFAULT_LANGUAGE);
  });
});
