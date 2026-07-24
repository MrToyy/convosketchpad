import { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, Monitor, Settings, Shield, X } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import { AppearanceSettings } from './AppearanceSettings';
import { ConnectionSettings } from './ConnectionSettings';
import { getSettingsCopy } from './messages';

interface SettingsDrawerProps {
  open: boolean; onClose: () => void;
  gatewayUrl: string; gatewayToken: string;
  onUrlChange: (value: string) => void; onTokenChange: (value: string) => void;
  onReconnect: () => void;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  onLogout?: () => void; onGatewayRestart?: () => void; gatewayRestarting?: boolean;
}

export function SettingsDrawer(props: SettingsDrawerProps) {
  const { language } = useSettings();
  const copy = getSettingsCopy(language);
  const [category, setCategory] = useState<'connection' | 'appearance'>('connection');
  const closeRef = useRef<HTMLButtonElement>(null);
  const onKeyDown = useCallback((event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose(); }, [props]);
  useEffect(() => {
    if (!props.open) return;
    document.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown, props.open]);
  if (!props.open) return null;
  return <>
    <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={props.onClose} />
    <div lang={language} role="dialog" aria-modal="true" className="fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l border-border/80 bg-card/95 shadow-2xl sm:w-[410px]">
      <div className="flex items-start justify-between border-b border-border/70 px-5 py-4"><div><span className="cockpit-kicker"><Settings size={14} />{copy.drawer.controlRoom}</span><div className="cockpit-title mt-2 text-lg">{copy.drawer.title}</div></div><button type="button" aria-label="Close settings" ref={closeRef} onClick={props.onClose} className="shell-icon-button"><X size={16} /></button></div>
      <div role="tablist" aria-label={copy.drawer.categoriesAria} className="flex gap-2 border-b border-border/60 p-4">
        <button type="button" role="tab" aria-selected={category === 'connection'} className="shell-chip flex-1 justify-center" data-active={category === 'connection'} onClick={() => setCategory('connection')}><Shield size={13} />{copy.drawer.categories.advanced}</button>
        <button type="button" role="tab" aria-selected={category === 'appearance'} className="shell-chip flex-1 justify-center" data-active={category === 'appearance'} onClick={() => setCategory('appearance')}><Monitor size={13} />{copy.drawer.categories.appearance}</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{category === 'appearance' ? <AppearanceSettings /> : <ConnectionSettings url={props.gatewayUrl} token={props.gatewayToken} onUrlChange={props.onUrlChange} onTokenChange={props.onTokenChange} onReconnect={props.onReconnect} connectionState={props.connectionState} onGatewayRestart={props.onGatewayRestart} gatewayRestarting={props.gatewayRestarting} />}</div>
      <div className="border-t border-border/70 p-4">{props.onLogout && <button onClick={props.onLogout} className="cockpit-toolbar-button w-full justify-center" data-tone="danger"><LogOut size={14} />{copy.drawer.signOut}</button>}<div className="mt-3 text-xs text-muted-foreground"><div className="flex justify-between"><span>ConvoSketchpad</span><span>v{__APP_VERSION__}</span></div><div className="mt-1">{__APP_TAGLINE__}</div></div></div>
    </div>
  </>;
}
