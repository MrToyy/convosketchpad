import { ALargeSmall, Languages, Monitor, Type } from 'lucide-react';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { useSettings } from '@/contexts/SettingsContext';
import { fonts, fontNames, type FontName } from '@/lib/fonts';
import type { Language } from '@/lib/language';
import { themes, themeNames, type ThemeName } from '@/lib/themes';
import { getSettingsCopy } from './messages';

const TRIGGER = 'min-h-11 w-full justify-between rounded-2xl border-border/80 bg-background/65 px-3 py-2 text-left text-sm font-sans text-foreground sm:min-w-[148px]';
const MENU = 'rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)]';
const FONT_SIZES = ['10', '11', '12', '13', '14', '15', '16', '17', '18', '20', '22', '24'];
const CHINESE_THEME_LABELS: Partial<Record<ThemeName, string>> = {
  midnight: '午夜',
  light: '浅色',
  phosphor: '荧光',
  dracula: '德古拉',
  nord: '北境',
  'solarized-dark': '暗色 Solarized',
  'catppuccin-mocha': '猫布奇诺·摩卡',
  'tokyo-night': '东京夜',
  'gruvbox-dark': '暗色 Gruvbox',
  'one-dark': 'One Dark',
  monokai: 'Monokai',
  'ayu-dark': '暗色 Ayu',
  'rose-pine': '玫瑰松',
  monochrome: '黑白',
};

export function AppearanceSettings() {
  const { language, setLanguage, theme, setTheme, font, setFont, fontSize, setFontSize } = useSettings();
  const copy = getSettingsCopy(language).appearance;
  const rows = [
    { icon: Languages, label: copy.language, hint: copy.languageHint, value: language, onChange: (value: string) => setLanguage(value as Language), options: [{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }], aria: copy.languageAria },
    { icon: Monitor, label: copy.theme, hint: copy.themeHint, value: theme, onChange: (value: string) => setTheme(value as ThemeName), options: themeNames.map((name) => ({ value: name, label: language === 'zh-CN' ? CHINESE_THEME_LABELS[name] || themes[name].label : themes[name].label })), aria: copy.themeAria },
    { icon: Type, label: copy.uiFont, hint: copy.uiFontHint, value: font, onChange: (value: string) => setFont(value as FontName), options: fontNames.map((name) => ({ value: name, label: fonts[name].label })), aria: copy.uiFontAria },
    { icon: ALargeSmall, label: copy.fontSize, hint: copy.fontSizeHint, value: String(fontSize), onChange: (value: string) => setFontSize(Number(value)), options: FONT_SIZES.map((value) => ({ value, label: value === '15' ? `${value}px (${copy.defaultSuffix})` : `${value}px` })), aria: copy.fontSizeAria },
  ];
  return <div className="space-y-4">
    <span className="cockpit-kicker"><span className="text-primary">◆</span>{copy.heading}</span>
    {rows.map(({ icon: Icon, label, hint, value, onChange, options, aria }) => <div key={label} className="cockpit-row items-start justify-between">
      <div className="flex min-w-0 items-start gap-3"><Icon size={14} className="text-primary" /><div className="flex flex-col"><span className="text-sm font-medium">{label}</span><span className="text-xs text-muted-foreground">{hint}</span></div></div>
      <InlineSelect value={value} onChange={onChange} options={options} ariaLabel={aria} triggerClassName={TRIGGER} menuClassName={MENU} />
    </div>)}
  </div>;
}
