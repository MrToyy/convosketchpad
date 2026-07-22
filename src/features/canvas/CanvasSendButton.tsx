import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/contexts/SettingsContext';
import { getCanvasCopy } from './messages';

interface CanvasSendButtonProps {
  sending: boolean;
  disabled: boolean;
  onSend: () => void;
}

/** Keeps the dynamic icon isolated from text nodes that browser translators may replace. */
export function CanvasSendButton({ sending, disabled, onSend }: CanvasSendButtonProps) {
  const { language } = useSettings();
  const copy = getCanvasCopy(language);

  return (
    <Button translate="no" type="button" onClick={onSend} disabled={disabled} className="notranslate">
      <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
        {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
      </span>
      <span data-canvas-send-label>{copy.send}</span>
    </Button>
  );
}
