import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Volume2, VolumeX, Mic, MicOff, Download, AlertTriangle, KeyRound, Globe } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { InlineSelect } from '@/components/ui/InlineSelect';
import type { TTSProvider } from '@/features/tts/useTTS';
import { useSettings, type STTInputMode, type STTProvider } from '@/contexts/SettingsContext';
import { useTTSConfig } from '@/features/tts/useTTSConfig';
import { VoicePhrasesModal } from './VoicePhrasesModal';
import { buildPrimaryWakePhrase } from '@/lib/constants';
import { shouldDeferEdgeVoiceAutoSwitch } from './audioSettingsUtils';
import { getWakeWordSupport } from '@/features/voice/wakeWordSupport';
import { getSettingsCopy, type SettingsCopy } from './messages';

// ─── Language types ──────────────────────────────────────────────────────────

interface LanguageInfo {
  code: string;
  name: string;
  nativeName: string;
}

interface LanguageState {
  language: string;
  supported: LanguageInfo[];
  providers: { edge: boolean; qwen3: boolean; openai: boolean };
}

interface LanguageSupportEntry {
  code: string;
  name: string;
  nativeName: string;
  edgeTtsVoices: { female: string; male: string };
  stt: { local: boolean; openai: boolean };
  tts: { edge: boolean; qwen3: boolean; openai: boolean };
}

interface EdgeVoiceOption {
  value: string;
  label: string;
}

const EDGE_ENGLISH_VOICE_OPTIONS: EdgeVoiceOption[] = [
  { value: 'en-US-AriaNeural', label: 'Aria (US)' },
  { value: 'en-US-JennyNeural', label: 'Jenny (US)' },
  { value: 'en-US-GuyNeural', label: 'Guy (US)' },
  { value: 'en-GB-SoniaNeural', label: 'Sonia (GB)' },
  { value: 'en-GB-RyanNeural', label: 'Ryan (GB)' },
  { value: 'en-AU-NatashaNeural', label: 'Natasha (AU)' },
  { value: 'en-IE-EmilyNeural', label: 'Emily (IE)' },
];

const INLINE_SELECT_TRIGGER_CLASS =
  'min-h-11 w-full justify-between rounded-2xl border-border/80 bg-background/65 px-3 py-2 text-left text-sm font-sans text-foreground sm:w-auto';
const INLINE_SELECT_MENU_CLASS =
  'rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)]';

function getEdgeVoiceOptions(
  lang: string,
  support: LanguageSupportEntry[] | null,
  languageName?: string,
): EdgeVoiceOption[] {
  if (lang === 'en') return EDGE_ENGLISH_VOICE_OPTIONS;

  const supportEntry = support?.find((s) => s.code === lang);
  if (supportEntry?.edgeTtsVoices) {
    const { female, male } = supportEntry.edgeTtsVoices;
    const fName = female.replace(/Neural$/, '').split('-').pop() || 'Female';
    const mName = male.replace(/Neural$/, '').split('-').pop() || 'Male';
    return [
      { value: female, label: `${fName} (${languageName || lang})` },
      { value: male, label: `${mName} (${languageName || lang})` },
    ];
  }

  // Safety fallback while support data is loading.
  return EDGE_ENGLISH_VOICE_OPTIONS;
}

/** Hook to manage language preference via the /api/language endpoints. */
function useLanguage() {
  const [state, setState] = useState<LanguageState | null>(null);
  const [support, setSupport] = useState<LanguageSupportEntry[] | null>(null);
  // Safer default: assume non-multilingual until support endpoint confirms otherwise.
  const [isMultilingual, setIsMultilingual] = useState(false);

  // Fetch current language on mount
  useEffect(() => {
    const langController = new AbortController();
    const supportController = new AbortController();

    fetch('/api/language', { signal: langController.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((langData) => {
        if (!langController.signal.aborted && langData) {
          setState(langData);
        }
      })
      .catch((err) => {
        if ((err as DOMException)?.name !== 'AbortError') {
          console.warn('[settings] failed to fetch /api/language');
        }
      });

    fetch('/api/language/support', { signal: supportController.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((supportData) => {
        if (!supportController.signal.aborted && supportData) {
          setSupport(Array.isArray(supportData.languages) ? supportData.languages : null);
          setIsMultilingual(Boolean(supportData.isMultilingual));
        }
      })
      .catch((err) => {
        if ((err as DOMException)?.name !== 'AbortError') {
          console.warn('[settings] failed to fetch /api/language/support');
        }
      });

    return () => {
      langController.abort();
      supportController.abort();
    };
  }, []);

  const setLanguage = useCallback(async (language: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/language', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language }),
      });
      if (!res.ok) return false;

      const data = await res.json();
      setState((prev) => prev ? { ...prev, language: data.language, providers: data.providers } : prev);
      return true;
    } catch {
      return false;
    }
  }, []);

  return { state, support, isMultilingual, setLanguage };
}

/** Single-line input that expands into a textarea on focus, collapses on blur. */
function ExpandableInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const collapse = useCallback(() => {
    // Small delay so click inside textarea doesn't trigger collapse
    setTimeout(() => {
      if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
        setExpanded(false);
      }
    }, 100);
  }, []);

  useEffect(() => {
    if (expanded && textareaRef.current) {
      textareaRef.current.focus();
      // Move cursor to end
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [expanded]);

  return (
    <div ref={containerRef} className="cockpit-row flex-col items-stretch gap-2">
      <span className="cockpit-field-label">{label}</span>
      {expanded ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={collapse}
          rows={4}
          className="min-h-[96px] w-full resize-none border-none bg-transparent p-0 text-sm text-foreground/82 outline-none transition-all"
          placeholder={placeholder}
        />
      ) : (
        <div
          onClick={() => setExpanded(true)}
          className="w-full cursor-text truncate text-sm text-foreground/72 opacity-80 transition-opacity hover:opacity-100"
          title={value || placeholder}
        >
          {value || <span className="text-muted-foreground">{placeholder}</span>}
        </div>
      )}
    </div>
  );
}

type AudioSettingsSection = 'all' | 'input' | 'output';

interface AudioSettingsProps {
  soundEnabled: boolean;
  onToggleSound: () => void;
  ttsProvider: TTSProvider;
  ttsModel: string;
  onTtsProviderChange: (provider: TTSProvider) => void;
  onTtsModelChange: (model: string) => void;
  sttProvider: STTProvider;
  sttInputMode: STTInputMode;
  sttModel: string;
  onSttProviderChange: (provider: STTProvider) => void;
  onSttInputModeChange: (mode: STTInputMode) => void;
  onSttModelChange: (model: string) => void;
  wakeWordEnabled: boolean;
  onToggleWakeWord: () => void;
  liveTranscriptionPreview: boolean;
  onToggleLiveTranscriptionPreview: () => void;
  agentName?: string;
  section?: AudioSettingsSection;
}

/** STT model selector with download progress and GPU warning. */
function SttModelSelector({ model, onModelChange, copy }: { model: string; onModelChange: (m: string) => void; copy: SettingsCopy['audio'] }) {
  const [download, setDownload] = useState<{ model: string; downloading: boolean; percent: number; error?: string } | null>(null);
  const [hasGpu, setHasGpu] = useState<boolean | null>(null);

  // Fetch GPU info once on mount
  useEffect(() => {
    fetch('/api/transcribe/config')
      .then((r) => r.json())
      .then((data) => { if (typeof data.hasGpu === 'boolean') setHasGpu(data.hasGpu); })
      .catch(() => {});
  }, []);

  // Poll for download progress when a download is active
  useEffect(() => {
    if (!download?.downloading) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/transcribe/config');
        if (!res.ok) return;
        const data = await res.json();
        if (data.download) {
          setDownload(data.download);
          if (!data.download.downloading) {
            // Download finished — stop polling after a beat
            setTimeout(() => setDownload(null), 2000);
          }
        } else {
          setDownload(null);
        }
      } catch { /* ignore */ }
    }, 500);
    return () => clearInterval(interval);
  }, [download?.downloading]);

  const handleModelChange = useCallback(async (newModel: string) => {
    onModelChange(newModel);
    // Check if server started a download
    try {
      await new Promise((r) => setTimeout(r, 300)); // brief wait for PUT to process
      const res = await fetch('/api/transcribe/config');
      if (res.ok) {
        const data = await res.json();
        if (data.download?.downloading) {
          setDownload(data.download);
        }
      }
    } catch { /* ignore */ }
  }, [onModelChange]);

  return (
    <div className="space-y-3">
      <div className="cockpit-row items-start justify-between">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-foreground">{copy.sttModel}</span>
          <p className="mt-1 text-xs text-muted-foreground">{copy.sttModelHint}</p>
        </div>
        <InlineSelect
          value={model}
          onChange={handleModelChange}
          options={[
            { value: 'tiny',     label: `tiny (75MB, ${copy.multilingual})` },
            { value: 'base',     label: `base (142MB, ${copy.multilingual})` },
            { value: 'small',    label: `small (466MB, ${copy.multilingual})` },
            { value: 'tiny.en',  label: `tiny.en (75MB, ${copy.englishOnly})` },
            { value: 'base.en',  label: `base.en (142MB, ${copy.englishOnly})` },
            { value: 'small.en', label: `small.en (466MB, ${copy.englishOnly})` },
          ]}
          ariaLabel={copy.sttModelAria}
          triggerClassName={`${INLINE_SELECT_TRIGGER_CLASS} min-w-[188px]`}
          menuClassName={`${INLINE_SELECT_MENU_CLASS} min-w-[250px]`}
          dropUp
        />
      </div>

      {/* Download progress */}
      {download?.downloading && (
        <div className="cockpit-note" data-tone="primary">
          <div className="flex items-center gap-2">
            <Download size={12} className="text-primary animate-pulse" />
            <span className="font-mono text-[0.733rem] text-primary">
              {copy.downloading(download.model, download.percent)}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border/40">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${download.percent}%` }}
            />
          </div>
        </div>
      )}

      {download && !download.downloading && download.error && (
        <div className="cockpit-note" data-tone="danger">
          <span className="font-mono text-[0.733rem] text-destructive">{copy.downloadFailed(download.error)}</span>
        </div>
      )}

      {download && !download.downloading && !download.error && (
        <div className="cockpit-note border-green/25 bg-green/8 text-green">
          <span className="font-mono text-[0.733rem] animate-pulse">{copy.modelReady}</span>
        </div>
      )}

      {/* No-GPU warning for heavier models */}
      {hasGpu === false && model !== 'tiny' && model !== 'tiny.en' && (
        <div className="rounded-[18px] border border-orange/30 bg-orange/6 px-3 py-3 text-orange/85">
          <div className="flex items-start gap-2">
          <AlertTriangle size={12} className="text-orange shrink-0 mt-0.5" />
          <span className="text-[0.733rem]">
            {copy.noGpuWarning(model, model.includes('small'))}
          </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Inline API key input shown when a provider needs a key that isn't configured. */
function ApiKeyInput({
  keyName,
  provider,
  fieldName,
  onSaved,
  copy,
}: {
  keyName: string;
  provider: string;
  fieldName: 'openaiKey' | 'replicateToken' | 'mimoApiKey';
  onSaved: () => void;
  copy: SettingsCopy['audio'];
}) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [fieldName]: value.trim() }),
      });
      if (res.ok) {
        setSaved(true);
        onSaved();
        setTimeout(() => setSaved(false), 2000);
      }
    } catch { /* ignore */ }
    setSaving(false);
  }, [value, fieldName, onSaved]);

  if (saved) {
    return (
      <div className="cockpit-note border-green/25 bg-green/8 text-green">
        <span className="font-mono text-[0.733rem]">{copy.apiKeySaved(keyName)}</span>
      </div>
    );
  }

  return (
    <div className="rounded-[20px] border border-orange/28 bg-orange/6 px-4 py-4">
      <div className="flex items-center gap-2">
        <KeyRound size={12} className="text-orange shrink-0" />
        <span className="text-[0.733rem] text-orange">{copy.apiKeyRequired(keyName, provider)}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={copy.apiKeyPlaceholder(keyName)}
          className="cockpit-input cockpit-input-mono h-11 flex-1"
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
        />
        <button
          onClick={handleSave}
          disabled={saving || !value.trim()}
          className="cockpit-toolbar-button px-4 text-[0.733rem] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? copy.saving : copy.save}
        </button>
      </div>
    </div>
  );
}

/** Available models per provider. */
const PROVIDER_MODELS: Record<TTSProvider, { value: string; label: string }[]> = {
  openai: [
    { value: '', label: 'gpt-4o-mini-tts (default)' },
    { value: 'tts-1', label: 'tts-1' },
    { value: 'tts-1-hd', label: 'tts-1-hd' },
  ],
  replicate: [
    { value: '', label: 'qwen-tts (default)' },
  ],
  xiaomi: [
    { value: 'mimo-v2-tts', label: 'mimo-v2-tts' },
  ],
  edge: [],
};

/** Settings section for notification sounds, TTS provider/model, and wake-word toggle. */
export function AudioSettings({
  soundEnabled,
  onToggleSound,
  ttsProvider,
  ttsModel,
  onTtsProviderChange,
  onTtsModelChange,
  sttProvider,
  sttInputMode,
  sttModel,
  onSttProviderChange,
  onSttInputModeChange,
  onSttModelChange,
  wakeWordEnabled,
  onToggleWakeWord,
  liveTranscriptionPreview,
  onToggleLiveTranscriptionPreview,
  agentName = 'Agent',
  section = 'all',
}: AudioSettingsProps) {
  const { language: interfaceLanguage } = useSettings();
  const copy = getSettingsCopy(interfaceLanguage).audio;
  const models = (PROVIDER_MODELS[ttsProvider] || []).map((model) => ({
    ...model,
    label: model.label.replace('(default)', `(${copy.defaultModel})`),
  }));
  const showInput = section === 'all' || section === 'input';
  const showOutput = section === 'all' || section === 'output';
  const wakeWordSupport = useMemo(() => getWakeWordSupport(), []);
  const wakeWordSupported = wakeWordSupport.supported;
  const effectiveWakeWordEnabled = wakeWordSupported ? wakeWordEnabled : false;
  const headingLabel = section === 'input' ? copy.inputHeading : section === 'output' ? copy.outputHeading : copy.heading;
  const headingCopy = section === 'input'
    ? copy.inputHeadingCopy
    : section === 'output'
      ? copy.outputHeadingCopy
      : '';
  const { config, saved, updateField } = useTTSConfig();
  const { state: langState, support, isMultilingual, setLanguage } = useLanguage();

  // Fetch API key status once on mount
  const [apiKeys, setApiKeys] = useState<{ openai: boolean; replicate: boolean; xiaomi: boolean }>({ openai: true, replicate: true, xiaomi: true });
  useEffect(() => {
    fetch('/api/keys')
      .then((r) => r.json())
      .then((data) => {
        setApiKeys({
          openai: !!data.openaiKeySet,
          replicate: !!data.replicateKeySet,
          xiaomi: !!data.xiaomiKeySet,
        });
      })
      .catch(() => {});
  }, []);

  // Voice phrases modal — opens when switching to non-English without configured phrases
  const [phrasesModal, setPhrasesModal] = useState<{
    open: boolean;
    code: string;
    name: string;
    nativeName: string;
  }>({ open: false, code: '', name: '', nativeName: '' });

  // Track which languages have custom phrases
  const [phrasesStatus, setPhrasesStatus] = useState<Record<string, { configured: boolean }>>({});
  const [activeWakePhrase, setActiveWakePhrase] = useState('');
  useEffect(() => {
    fetch('/api/voice-phrases/status')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to fetch phrase status');
        return r.json();
      })
      .then(setPhrasesStatus)
      .catch(() => {});
  }, [phrasesModal.open]); // Refetch after modal closes (might have saved)

  useEffect(() => {
    const lang = langState?.language;
    if (!lang) return;

    let cancelled = false;
    fetch(`/api/voice-phrases?lang=${lang}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const customWake = Array.isArray(data?.wakePhrases)
          ? data.wakePhrases.map((phrase: string) => phrase.trim()).find(Boolean) || ''
          : '';
        setActiveWakePhrase(customWake);
      })
      .catch(() => {
        if (!cancelled) setActiveWakePhrase('');
      });

    return () => {
      cancelled = true;
    };
  }, [langState?.language, phrasesModal.open]);

  // Keep language switches lightweight; phrase editing is explicit via the CTA button.
  const handleLanguageChange = useCallback((code: string) => {
    void setLanguage(code).then((saved) => {
      if (!saved) return;
      // Notify InputBar after language update succeeds
      window.dispatchEvent(new CustomEvent('nerve:language-changed'));
    });
  }, [setLanguage]);

  const currentLangInfo = useMemo(() => {
    if (!langState) return null;
    return langState.supported.find((l) => l.code === langState.language) || null;
  }, [langState]);
  const currentLanguageName = currentLangInfo
    ? copy.voiceLanguageName(currentLangInfo.code, currentLangInfo.name)
    : langState?.language || '';

  const isNonEnglishLocalStt = Boolean(langState && langState.language !== 'en' && sttProvider === 'local');
  const showEnglishOnlyWarning = isNonEnglishLocalStt && !isMultilingual;
  const showTinyAccuracyWarning = isNonEnglishLocalStt && isMultilingual && sttModel === 'tiny';

  // All 13 OpenAI TTS voices. tts-1 and tts-1-hd only support a subset (no ballad, cedar, marin, verse).
  const LEGACY_ONLY_VOICES = new Set(['ballad', 'cedar', 'marin', 'verse']);
  const isLegacyModel = ttsModel === 'tts-1' || ttsModel === 'tts-1-hd';
  const OPENAI_VOICES = Object.entries(copy.openAiVoiceDescriptions)
    .map(([value, description]) => ({ value, label: `${value.charAt(0).toUpperCase()}${value.slice(1)} — ${description}` }))
    .filter(v => !isLegacyModel || !LEGACY_ONLY_VOICES.has(v.value));

  // Build Edge voice options from selected language.
  const edgeVoicesForLang = getEdgeVoiceOptions(
    langState?.language || 'en',
    support,
    currentLanguageName,
  );

  // Keep Edge voice consistent with language choice.
  // If the currently saved voice is invalid for the selected language,
  // auto-switch to that language's default Edge voice and save immediately.
  useEffect(() => {
    if (!langState?.language || !config) return;

    // For non-English languages, wait until support matrix is loaded.
    // Otherwise we may temporarily see English fallback options and persist
    // an incorrect English voice before language voices arrive.
    if (shouldDeferEdgeVoiceAutoSwitch(langState.language, support)) {
      return;
    }

    const options = getEdgeVoiceOptions(langState.language, support, currentLanguageName);
    const fallbackVoice = options[0]?.value;
    if (!fallbackVoice) return;

    const currentVoice = config.edge.voice;
    const isEnglishOverride = langState.language === 'en' && /^en-/i.test(currentVoice);
    const isValid = isEnglishOverride || options.some((opt) => opt.value === currentVoice);
    if (!isValid && currentVoice !== fallbackVoice) {
      updateField('edge', 'voice', fallbackVoice);
    }
  }, [config, currentLanguageName, langState?.language, support, updateField]);

  const wakePhraseDisplay = useMemo(() => {
    const phrase = buildPrimaryWakePhrase(agentName, langState?.language || 'en', activeWakePhrase ? [activeWakePhrase] : undefined);
    if (!phrase) return `Hey ${agentName}`;
    return phrase.charAt(0).toUpperCase() + phrase.slice(1);
  }, [activeWakePhrase, agentName, langState?.language]);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="cockpit-kicker">
          <span className="text-primary">◆</span>
          {headingLabel}
        </span>
        {headingCopy && <p className="cockpit-copy max-w-[36ch]">{headingCopy}</p>}
      </div>

      {/* Language Preference */}
      {showInput && langState && (
        <div className="space-y-3">
          <div className="cockpit-row flex-col items-stretch gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <Globe size={14} className="text-primary" aria-hidden="true" />
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-foreground">{copy.language}</span>
                <span className="text-xs text-muted-foreground">{copy.languageHint}</span>
              </div>
            </div>
            <InlineSelect
              value={langState.language}
              onChange={handleLanguageChange}
              options={langState.supported.map((l) => ({
                value: l.code,
                label: copy.voiceLanguageLabel(l.code, l.name, l.nativeName),
              }))}
              ariaLabel={copy.languageAria}
              triggerClassName={`${INLINE_SELECT_TRIGGER_CLASS} w-full justify-between`}
              menuClassName={`${INLINE_SELECT_MENU_CLASS} min-w-[220px] max-w-[calc(100vw-2rem)]`}
            />
          </div>

          {/* Compatibility warnings */}
          {showEnglishOnlyWarning && (
            <div className="rounded-[18px] border border-orange/30 bg-orange/6 px-3 py-3 text-orange/85">
              <div className="flex items-start gap-2">
              <AlertTriangle size={12} className="text-orange shrink-0 mt-0.5" />
              <span className="text-[0.733rem]">
                {copy.englishOnlyWarning(currentLanguageName)}
              </span>
              </div>
            </div>
          )}

          {showTinyAccuracyWarning && (
            <div className="rounded-[18px] border border-orange/30 bg-orange/6 px-3 py-3 text-orange/85">
              <div className="flex items-start gap-2">
              <AlertTriangle size={12} className="text-orange shrink-0 mt-0.5" />
              <div className="flex flex-1 items-start justify-between gap-2">
                <span className="text-[0.733rem]">
                  {copy.tinyWarning(currentLanguageName)}
                </span>
                <button
                  onClick={() => onSttModelChange('base')}
                  className="cockpit-toolbar-button shrink-0 border-orange/40 px-3 text-[0.733rem] text-orange hover:border-orange/55 hover:bg-orange/10"
                >
                  {copy.useBase}
                </button>
              </div>
              </div>
            </div>
          )}

          {/* Configure Voice Phrases button — available for all languages (including English) */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                setPhrasesModal({
                  open: true,
                  code: langState.language,
                  name: currentLangInfo?.name || langState.language,
                  nativeName: currentLangInfo?.nativeName || langState.language,
                });
              }}
              className="cockpit-row group w-full items-start justify-between text-left"
            >
              <div className="flex items-start gap-3">
                <Mic size={14} className="text-primary" aria-hidden="true" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">{copy.voicePhrases}</span>
                  <span className="text-xs text-muted-foreground">{copy.voicePhrasesHint(currentLanguageName)}</span>
                </div>
              </div>
              <span className="cockpit-badge group-hover:text-primary" data-tone={phrasesStatus[langState.language]?.configured ? 'primary' : undefined}>
                {phrasesStatus[langState.language]?.configured ? copy.edit : copy.configure}
              </span>
            </button>
            {!phrasesStatus[langState.language]?.configured && (
              <span className="cockpit-field-hint px-1">
                {copy.voicePhrasesOptional(currentLanguageName)}
              </span>
            )}
          </div>

        </div>
      )}

      {/* Sound Effects */}
      {showOutput && (
        <div className="cockpit-row items-start justify-between">
          <div className="flex items-center gap-3">
            {soundEnabled ? (
              <Volume2 size={14} className="text-green" aria-hidden="true" />
            ) : (
              <VolumeX size={14} className="text-muted-foreground" aria-hidden="true" />
            )}
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground" id="sound-label">{copy.soundEffects}</span>
              <span className="text-xs text-muted-foreground">{copy.soundEffectsHint}</span>
            </div>
          </div>
          <Switch
            checked={soundEnabled}
            onCheckedChange={onToggleSound}
            aria-label={copy.soundEffectsAria}
          />
        </div>
      )}

      {/* TTS Provider */}
      {showOutput && (
        <div className="space-y-2">
          <span className="cockpit-field-label">{copy.ttsProvider}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onTtsProviderChange('openai')}
              data-active={ttsProvider === 'openai'}
              className="shell-chip min-h-11 flex-1 justify-center rounded-2xl px-3 py-2 text-sm font-medium"
            >
              OpenAI
            </button>
            <button
              type="button"
              onClick={() => onTtsProviderChange('replicate')}
              data-active={ttsProvider === 'replicate'}
              className="shell-chip min-h-11 flex-1 justify-center rounded-2xl px-3 py-2 text-sm font-medium"
            >
              Replicate
            </button>
            <button
              type="button"
              onClick={() => onTtsProviderChange('edge')}
              data-active={ttsProvider === 'edge'}
              className="shell-chip min-h-11 flex-1 justify-center rounded-2xl px-3 py-2 text-sm font-medium"
            >
              Edge ({copy.free})
            </button>
            <button
              type="button"
              onClick={() => onTtsProviderChange('xiaomi')}
              data-active={ttsProvider === 'xiaomi'}
              className="shell-chip min-h-11 flex-1 justify-center rounded-2xl px-3 py-2 text-sm font-medium"
            >
              Xiaomi Mimo
            </button>
          </div>
          <p className="cockpit-field-hint px-1">{copy.ttsProviderHint}</p>

          {langState?.language && langState.language !== 'en' && ttsProvider === 'replicate' && !langState.providers.qwen3 && (
            <div className="rounded-[18px] border border-orange/30 bg-orange/6 px-3 py-3 text-orange/85">
              <div className="flex items-start gap-2">
              <AlertTriangle size={12} className="text-orange shrink-0 mt-0.5" />
              <span className="text-[0.733rem]">
                {copy.qwenUnsupported(currentLanguageName)}
              </span>
              </div>
            </div>
          )}

        </div>
      )}

      {/* TTS API key input */}
      {showOutput && ttsProvider === 'openai' && !apiKeys.openai && (
        <ApiKeyInput copy={copy} keyName="OPENAI_API_KEY" provider="OpenAI TTS" fieldName="openaiKey" onSaved={() => setApiKeys(k => ({ ...k, openai: true }))} />
      )}
      {showOutput && ttsProvider === 'replicate' && !apiKeys.replicate && (
        <ApiKeyInput copy={copy} keyName="REPLICATE_API_TOKEN" provider="Replicate TTS" fieldName="replicateToken" onSaved={() => setApiKeys(k => ({ ...k, replicate: true }))} />
      )}
      {showOutput && ttsProvider === 'xiaomi' && !apiKeys.xiaomi && (
        <ApiKeyInput copy={copy} keyName="MIMO_API_KEY" provider="Xiaomi Mimo" fieldName="mimoApiKey" onSaved={() => setApiKeys(k => ({ ...k, xiaomi: true }))} />
      )}

      {/* TTS Model (shown when provider has multiple models) */}
      {showOutput && models.length > 0 && (
        <div className="cockpit-row items-start justify-between">
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium text-foreground">{copy.ttsModel}</span>
            <p className="mt-1 text-xs text-muted-foreground">{copy.ttsModelHint}</p>
          </div>
          <InlineSelect
            value={ttsProvider === 'xiaomi' ? (ttsModel || config?.xiaomi.model || '') : ttsModel}
            onChange={(value) => {
              onTtsModelChange(value);
              if (ttsProvider === 'xiaomi') updateField('xiaomi', 'model', value);
            }}
            options={models}
            ariaLabel={copy.ttsModelAria}
            triggerClassName={`${INLINE_SELECT_TRIGGER_CLASS} min-w-[188px]`}
            menuClassName={`${INLINE_SELECT_MENU_CLASS} min-w-[200px]`}
          />
        </div>
      )}

      {/* Voice Config */}
      {showOutput && config && (
        <div className="space-y-3">
          {saved && (
            <div className="cockpit-note border-green/25 bg-green/8 text-green">
              <span className="font-mono text-[0.733rem] animate-pulse">{copy.saved}</span>
            </div>
          )}

          {ttsProvider === 'openai' && (
            <>
              <div className="cockpit-row items-start justify-between">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-foreground">{copy.voice}</span>
                  <p className="mt-1 text-xs text-muted-foreground">{copy.openAiVoiceHint}</p>
                </div>
                <InlineSelect
                  value={config.openai.voice}
                  onChange={(v) => updateField('openai', 'voice', v)}
                  options={OPENAI_VOICES}
                  ariaLabel={copy.openAiVoiceAria}
                  triggerClassName={`${INLINE_SELECT_TRIGGER_CLASS} min-w-[220px]`}
                  menuClassName={`${INLINE_SELECT_MENU_CLASS} min-w-[260px]`}
                />
              </div>
              <ExpandableInput
                label={copy.voiceInstructions}
                value={config.openai.instructions}
                onChange={(v) => updateField('openai', 'instructions', v)}
                placeholder={copy.voiceInstructionsPlaceholder}
              />
            </>
          )}

          {ttsProvider === 'edge' && (
            <div className="cockpit-row items-start justify-between">
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-foreground">{copy.voice}</span>
                <p className="mt-1 text-xs text-muted-foreground">{copy.edgeVoiceHint}</p>
              </div>
              <InlineSelect
                value={config.edge.voice}
                onChange={(v) => updateField('edge', 'voice', v)}
                options={edgeVoicesForLang}
                ariaLabel={copy.edgeVoiceAria}
                triggerClassName={`${INLINE_SELECT_TRIGGER_CLASS} min-w-[188px]`}
                menuClassName={`${INLINE_SELECT_MENU_CLASS} min-w-[180px]`}
              />
            </div>
          )}

          {ttsProvider === 'replicate' && (
            <>
              <ExpandableInput
                label={copy.voiceDescription}
                value={config.qwen.voiceDescription}
                onChange={(v) => updateField('qwen', 'voiceDescription', v)}
                placeholder={copy.voiceDescriptionPlaceholder}
              />
              <ExpandableInput
                label={copy.styleInstruction}
                value={config.qwen.styleInstruction}
                onChange={(v) => updateField('qwen', 'styleInstruction', v)}
                placeholder={copy.styleInstructionPlaceholder}
              />
            </>
          )}

          {ttsProvider === 'xiaomi' && (
            <>
              <div className="cockpit-row items-start justify-between">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-foreground">{copy.voice}</span>
                  <p className="mt-1 text-xs text-muted-foreground">{copy.xiaomiVoiceHint}</p>
                </div>
                <InlineSelect
                  value={config.xiaomi.voice}
                  onChange={(v) => updateField('xiaomi', 'voice', v)}
                  options={[
                    { value: 'mimo_default', label: 'mimo_default' },
                    { value: 'default_zh', label: 'default_zh' },
                    { value: 'default_en', label: 'default_en' },
                  ]}
                  ariaLabel={copy.xiaomiVoiceAria}
                  triggerClassName={`${INLINE_SELECT_TRIGGER_CLASS} min-w-[188px]`}
                  menuClassName={`${INLINE_SELECT_MENU_CLASS} min-w-[188px]`}
                />
              </div>
              <ExpandableInput
                label={copy.style}
                value={config.xiaomi.style}
                onChange={(v) => updateField('xiaomi', 'style', v)}
                placeholder={copy.stylePlaceholder}
              />
            </>
          )}
        </div>
      )}

      {/* Wake Word */}
      {showInput && (
        <div className="cockpit-row items-start justify-between">
          <div className="flex items-center gap-3">
            {effectiveWakeWordEnabled ? (
              <Mic size={14} className="text-green" aria-hidden="true" />
            ) : (
              <MicOff size={14} className="text-muted-foreground" aria-hidden="true" />
            )}
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground" id="wake-word-label">{copy.wakeWord}</span>
              {wakeWordSupported ? (
                <span className="text-xs text-muted-foreground">{copy.wakeWordActive(wakePhraseDisplay)}</span>
              ) : (
                <>
                  <span className="text-xs text-muted-foreground">{copy.wakeWordUnsupported}</span>
                  <span className="text-xs text-muted-foreground">{copy.wakeWordManual}</span>
                </>
              )}
            </div>
          </div>
          <Switch
            checked={effectiveWakeWordEnabled}
            onCheckedChange={onToggleWakeWord}
            disabled={!wakeWordSupported}
            aria-label={copy.wakeWordAria}
          />
        </div>
      )}

      {/* Speech-to-Text */}
      {showInput && (
        <div className="space-y-1.5 pt-2">
          <span className="cockpit-kicker">
            <span className="text-primary">◆</span>
            {copy.speechToText}
          </span>
        </div>
      )}

      {showInput && (
        <div className="space-y-2">
          <span className="cockpit-field-label">{copy.sttProvider}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onSttProviderChange('local')}
              data-active={sttProvider === 'local'}
              className="shell-chip min-h-11 flex-1 justify-center rounded-2xl px-3 py-2 text-sm font-medium"
            >
              {copy.localFree}
            </button>
            <button
              type="button"
              onClick={() => onSttProviderChange('openai')}
              data-active={sttProvider === 'openai'}
              className="shell-chip min-h-11 flex-1 justify-center rounded-2xl px-3 py-2 text-sm font-medium"
            >
              OpenAI
            </button>
          </div>
          <span className="cockpit-field-hint px-1">
            {sttProvider === 'local'
              ? copy.localSttHint
              : apiKeys.openai
                ? copy.openAiSttHint
                : copy.openAiSttKeyHint}
          </span>
        </div>
      )}

      {/* STT Model selector (only for local provider) */}
      {showInput && sttProvider === 'local' && (
        <SttModelSelector copy={copy} model={sttModel} onModelChange={onSttModelChange} />
      )}

      {showInput && sttProvider === 'local' && (
        <div className="space-y-2">
          <div className="cockpit-row items-start justify-between">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium text-foreground">{copy.inputMode}</span>
              <span className="text-xs text-muted-foreground">{copy.inputModeHint}</span>
            </div>
            <InlineSelect
              value={sttInputMode}
              onChange={(value) => onSttInputModeChange(value as STTInputMode)}
              options={[
                { value: 'hybrid', label: copy.inputModes.hybrid },
                { value: 'browser', label: copy.inputModes.browser },
                { value: 'local', label: copy.inputModes.local },
              ]}
              ariaLabel={copy.inputModeAria}
              triggerClassName={`${INLINE_SELECT_TRIGGER_CLASS} w-full shrink-0 sm:w-[132px]`}
              menuClassName={`${INLINE_SELECT_MENU_CLASS} min-w-[140px]`}
            />
          </div>
          <span className="cockpit-field-hint px-1">
            {sttInputMode === 'browser'
              ? copy.inputModeDescriptions.browser
              : sttInputMode === 'local'
                ? copy.inputModeDescriptions.local
                : copy.inputModeDescriptions.hybrid}
          </span>
        </div>
      )}

      {showInput && (
        <div className="cockpit-row items-start justify-between">
          <div className="flex items-center gap-3">
            <Mic size={14} className={liveTranscriptionPreview ? 'text-primary' : 'text-muted-foreground'} aria-hidden="true" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground" id="live-transcription-label">{copy.livePreview}</span>
              <span className="text-xs text-muted-foreground">{copy.livePreviewHint}</span>
            </div>
          </div>
          <Switch
            checked={liveTranscriptionPreview}
            onCheckedChange={onToggleLiveTranscriptionPreview}
            aria-label={copy.livePreviewAria}
          />
        </div>
      )}

      {/* STT API key input */}
      {showInput && sttProvider === 'openai' && !apiKeys.openai && (
        <ApiKeyInput copy={copy} keyName="OPENAI_API_KEY" provider="OpenAI Whisper" fieldName="openaiKey" onSaved={() => setApiKeys(k => ({ ...k, openai: true }))} />
      )}

      {/* Voice Phrases Modal — shown when switching to non-English language */}
      <VoicePhrasesModal
        open={phrasesModal.open}
        onClose={() => {
          setPhrasesModal(prev => ({ ...prev, open: false }));
          // Phrases may have changed — notify voice input to refetch phrase config.
          window.dispatchEvent(new CustomEvent('nerve:voice-phrases-changed'));
        }}
        languageCode={phrasesModal.code}
        languageName={phrasesModal.name}
        languageNativeName={phrasesModal.nativeName}
      />
    </div>
  );
}
