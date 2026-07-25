import type { ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { LANGUAGE_STORAGE_KEY, type Language } from '@/lib/language';

export function renderWithSettings(
  ui: ReactElement,
  language: Language = 'zh-CN',
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  return render(<SettingsProvider>{ui}</SettingsProvider>, options);
}
