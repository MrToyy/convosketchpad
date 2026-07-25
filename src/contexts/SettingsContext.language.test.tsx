import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsProvider, useSettings } from './SettingsContext';
import { LANGUAGE_STORAGE_KEY } from '@/lib/language';

vi.mock('@/features/tts/useTTS', () => ({
  migrateTTSProvider: (value: string) => value,
  useTTS: () => ({ speak: vi.fn() }),
}));

describe('SettingsContext language', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to Chinese and persists a supported selection', () => {
    const { result } = renderHook(() => useSettings(), { wrapper: SettingsProvider });
    expect(result.current.language).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');

    act(() => result.current.setLanguage('en'));

    expect(result.current.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
  });

  it('falls back when storage contains an unsupported language', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr');
    const { result } = renderHook(() => useSettings(), { wrapper: SettingsProvider });
    expect(result.current.language).toBe('zh-CN');
  });
});
