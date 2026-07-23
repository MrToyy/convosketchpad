/* eslint-disable react-refresh/only-export-components -- hook intentionally co-located with provider */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyFont, fontNames, type FontName } from '@/lib/fonts';
import { LANGUAGE_STORAGE_KEY, normalizeLanguage, type Language } from '@/lib/language';
import { applyTheme, themeNames, type ThemeName } from '@/lib/themes';

interface SettingsContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  font: FontName;
  setFont: (font: FontName) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);
const FONT_SIZES = new Set([10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24]);

function initialFont(): FontName {
  const saved = localStorage.getItem('oc-font');
  return saved && fontNames.includes(saved as FontName) ? saved as FontName : 'instrument-sans';
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY)));
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const saved = localStorage.getItem('oc-theme') as ThemeName | null;
    return saved && themeNames.includes(saved) ? saved : 'ayu-dark';
  });
  const [font, setFontState] = useState<FontName>(initialFont);
  const [fontSize, setFontSizeState] = useState(() => {
    const parsed = Number(localStorage.getItem('nerve:font-size'));
    return FONT_SIZES.has(parsed) ? parsed : 15;
  });

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => applyFont(font), [font]);
  useEffect(() => document.documentElement.style.setProperty('--font-size-base', `${fontSize}px`), [fontSize]);

  const setLanguage = useCallback((value: Language) => {
    const normalized = normalizeLanguage(value);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
    setLanguageState(normalized);
  }, []);
  const setTheme = useCallback((value: ThemeName) => { localStorage.setItem('oc-theme', value); setThemeState(value); }, []);
  const setFont = useCallback((value: FontName) => { localStorage.setItem('oc-font', value); setFontState(value); }, []);
  const setFontSize = useCallback((value: number) => {
    const normalized = FONT_SIZES.has(value) ? value : 15;
    localStorage.setItem('nerve:font-size', String(normalized));
    setFontSizeState(normalized);
  }, []);

  const value = useMemo(() => ({ language, setLanguage, theme, setTheme, font, setFont, fontSize, setFontSize }), [language, setLanguage, theme, setTheme, font, setFont, fontSize, setFontSize]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used within SettingsProvider');
  return context;
}
