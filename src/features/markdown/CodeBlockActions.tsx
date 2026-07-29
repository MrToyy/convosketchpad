import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import { getAppCopy } from '@/lib/app-messages';

interface CodeBlockActionsProps {
  code: string;
}

/** Copy-to-clipboard control for fenced code blocks. */
export function CodeBlockActions({ code }: CodeBlockActionsProps) {
  const { language: interfaceLanguage } = useSettings();
  const copy = getAppCopy(interfaceLanguage);
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  const handleCopy = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = null;
      }, 1500);
    } catch (err) {
      console.warn('Clipboard copy failed', err);
    }
  }, [code]);

  return (
    <div className="code-block-actions">
      <button
        className="code-action-btn"
        onClick={handleCopy}
        aria-label={copied ? copy.code.copiedAria : copy.code.copyAria}
        title={copied ? copy.code.copied : copy.code.copy}
      >
        {copied ? (
          <Check size={14} className="code-action-feedback" aria-hidden="true" />
        ) : (
          <Copy size={14} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
