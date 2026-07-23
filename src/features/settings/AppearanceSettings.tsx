import { Monitor, Eye, Type, Activity, ALargeSmall, Code2, Command, Languages } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { useSettings } from '@/contexts/SettingsContext';
import { themes, themeNames, type ThemeName } from '@/lib/themes';
import { fonts, fontNames, type FontName } from '@/lib/fonts';
import type { Language } from '@/lib/language';
import { getSettingsCopy } from './messages';

const INLINE_SELECT_TRIGGER_CLASS =
  'min-h-11 w-full justify-between rounded-2xl border-border/80 bg-background/65 px-3 py-2 text-left text-sm font-sans text-foreground sm:min-w-[148px]';
const INLINE_SELECT_MENU_CLASS =
  'rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)]';

const FONT_SIZES = ['10', '11', '12', '13', '14', '15', '16', '17', '18', '20', '22', '24'];

const LANGUAGE_OPTIONS = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
];

/** Settings section for theme, font, font size, and panel visibility. */
export function AppearanceSettings() {
  const {
    language,
    setLanguage,
    eventsVisible,
    toggleEvents,
    logVisible,
    toggleLog,
    showHiddenWorkspaceEntries,
    toggleShowHiddenWorkspaceEntries,
    commandPaletteButtonVisible,
    toggleCommandPaletteButtonVisible,
    theme,
    setTheme,
    font,
    setFont,
    fontSize,
    setFontSize,
    editorFontSize,
    setEditorFontSize,
  } = useSettings();
  const copy = getSettingsCopy(language).appearance;
  const fontSizeOptions = FONT_SIZES.map((value) => ({
    value,
    label: value === '15' ? `${value}px (${copy.defaultSuffix})` : `${value}px`,
  }));
  const editorFontSizeOptions = FONT_SIZES.map((value) => ({
    value,
    label: value === '13' ? `${value}px (${copy.defaultSuffix})` : `${value}px`,
  }));

  const handleThemeChange = (next: string) => {
    setTheme(next as ThemeName);
  };

  const handleFontChange = (next: string) => {
    setFont(next as FontName);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="cockpit-kicker">
          <span className="text-primary">◆</span>
          {copy.heading}
        </span>
      </div>

      {/* Interface language currently applies to Canvas and Settings. */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Languages size={14} className="text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">{copy.language}</span>
            <span className="text-xs text-muted-foreground">{copy.languageHint}</span>
          </div>
        </div>
        <div className="relative w-full sm:w-auto">
          <InlineSelect
            value={language}
            onChange={(next) => setLanguage(next as Language)}
            options={LANGUAGE_OPTIONS}
            ariaLabel={copy.languageAria}
            triggerClassName={INLINE_SELECT_TRIGGER_CLASS}
            menuClassName={INLINE_SELECT_MENU_CLASS}
          />
        </div>
      </div>

      {/* Theme selector */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Monitor size={14} className="text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">{copy.theme}</span>
            <span className="text-xs text-muted-foreground">{copy.themeHint}</span>
          </div>
        </div>
        <div className="relative w-full sm:w-auto">
          <InlineSelect
            value={theme}
            onChange={handleThemeChange}
            options={themeNames.map((name) => ({ value: name, label: themes[name].label }))}
            ariaLabel={copy.themeAria}
            triggerClassName={INLINE_SELECT_TRIGGER_CLASS}
            menuClassName={INLINE_SELECT_MENU_CLASS}
          />
        </div>
      </div>

      {/* Font selector */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Type size={14} className="text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">{copy.uiFont}</span>
            <span className="text-xs text-muted-foreground">{copy.uiFontHint}</span>
          </div>
        </div>
        <div className="relative w-full sm:w-auto">
          <InlineSelect
            value={font}
            onChange={handleFontChange}
            options={fontNames.map((name) => ({ value: name, label: fonts[name].label }))}
            ariaLabel={copy.uiFontAria}
            triggerClassName={INLINE_SELECT_TRIGGER_CLASS}
            menuClassName={INLINE_SELECT_MENU_CLASS}
          />
        </div>
      </div>

      {/* Font size selector */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <ALargeSmall size={14} className="text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">{copy.fontSize}</span>
            <span className="text-xs text-muted-foreground">{copy.fontSizeHint}</span>
          </div>
        </div>
        <div className="relative w-full sm:w-auto">
          <InlineSelect
            value={String(fontSize)}
            onChange={(next) => setFontSize(parseInt(next, 10))}
            options={fontSizeOptions}
            ariaLabel={copy.fontSizeAria}
            triggerClassName={INLINE_SELECT_TRIGGER_CLASS}
            menuClassName={INLINE_SELECT_MENU_CLASS}
          />
        </div>
      </div>

      {/* Editor font size selector */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Code2 size={14} className="text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">{copy.editorFontSize}</span>
            <span className="text-xs text-muted-foreground">{copy.editorFontSizeHint}</span>
          </div>
        </div>
        <div className="relative w-full sm:w-auto">
          <InlineSelect
            value={String(editorFontSize)}
            onChange={(next) => setEditorFontSize(parseInt(next, 10))}
            options={editorFontSizeOptions}
            ariaLabel={copy.editorFontSizeAria}
            triggerClassName={INLINE_SELECT_TRIGGER_CLASS}
            menuClassName={INLINE_SELECT_MENU_CLASS}
          />
        </div>
      </div>

      {/* Events Panel Visibility */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex items-center gap-3">
          <Eye size={14} className={eventsVisible ? 'text-primary' : 'text-muted-foreground'} aria-hidden="true" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground" id="events-label">{copy.showEvents}</span>
            <span className="text-xs text-muted-foreground">{copy.showEventsHint}</span>
          </div>
        </div>
        <Switch
          checked={eventsVisible}
          onCheckedChange={toggleEvents}
          aria-label={copy.showEventsAria}
        />
      </div>

      {/* Log Panel Visibility */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex items-center gap-3">
          <Activity size={14} className={logVisible ? 'text-green' : 'text-muted-foreground'} aria-hidden="true" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground" id="log-label">{copy.showLog}</span>
            <span className="text-xs text-muted-foreground">{copy.showLogHint}</span>
          </div>
        </div>
        <Switch
          checked={logVisible}
          onCheckedChange={toggleLog}
          aria-label={copy.showLogAria}
        />
      </div>

      {/* Hidden workspace entries visibility */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex items-center gap-3">
          <Eye size={14} className={showHiddenWorkspaceEntries ? 'text-primary' : 'text-muted-foreground'} aria-hidden="true" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground" id="hidden-workspace-entries-label">{copy.showHidden}</span>
            <span className="text-xs text-muted-foreground">{copy.showHiddenHint}</span>
          </div>
        </div>
        <Switch
          checked={showHiddenWorkspaceEntries}
          onCheckedChange={toggleShowHiddenWorkspaceEntries}
          aria-label={copy.showHiddenAria}
        />
      </div>

      {/* Chatbox command palette visibility */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex items-center gap-3">
          <Command size={14} className={commandPaletteButtonVisible ? 'text-primary' : 'text-muted-foreground'} aria-hidden="true" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground" id="chatbox-commands-label">{copy.showCommands}</span>
            <span className="text-xs text-muted-foreground">{copy.showCommandsHint}</span>
          </div>
        </div>
        <Switch
          checked={commandPaletteButtonVisible}
          onCheckedChange={toggleCommandPaletteButtonVisible}
          aria-labelledby="chatbox-commands-label"
        />
      </div>

    </div>
  );
}
