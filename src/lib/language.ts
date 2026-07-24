export const languages = ['zh-CN', 'en'] as const;

export type Language = (typeof languages)[number];

export const DEFAULT_LANGUAGE: Language = 'zh-CN';
export const LANGUAGE_STORAGE_KEY = 'convosketchpad:language';

export function normalizeLanguage(value: string | null | undefined): Language {
  return languages.includes(value as Language) ? value as Language : DEFAULT_LANGUAGE;
}
