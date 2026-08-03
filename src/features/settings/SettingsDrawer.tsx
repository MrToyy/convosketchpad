import { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, Monitor, ServerCog, Settings, X } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import { AppearanceSettings } from './AppearanceSettings';
import { SystemSettings } from './SystemSettings';
import { getSettingsCopy } from './messages';
import type { AgentRuntimeStatus } from '@/hooks/useRuntimeEvents';

interface SettingsDrawerProps {
  open: boolean; onClose: () => void;
  onRefreshStatus: () => void;
  runtimeStatuses: Record<string, AgentRuntimeStatus>;
  onLogout?: () => void;
  onRuntimeRestart?: (runtimeId: string) => void;
  runtimeRestarting?: boolean;
}

export function SettingsDrawer(props: SettingsDrawerProps) {
  const { language } = useSettings();
  const copy = getSettingsCopy(language);
  const [category, setCategory] = useState<'appearance' | 'system'>('appearance');
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
      <div className="flex items-start justify-between border-b border-border/70 px-5 py-4"><div><span className="cockpit-kicker"><Settings size={14} />{copy.drawer.controlRoom}</span><div className="cockpit-title mt-2 text-lg">{copy.drawer.title}</div></div><button type="button" aria-label={copy.drawer.close} ref={closeRef} onClick={props.onClose} className="shell-icon-button"><X size={16} /></button></div>
      <div role="tablist" aria-label={copy.drawer.categoriesAria} className="flex gap-2 border-b border-border/60 p-4">
        <button type="button" role="tab" aria-selected={category === 'appearance'} className="shell-chip flex-1 justify-center" data-active={category === 'appearance'} onClick={() => setCategory('appearance')}><Monitor size={13} />{copy.drawer.categories.appearance}</button>
        <button type="button" role="tab" aria-selected={category === 'system'} className="shell-chip flex-1 justify-center" data-active={category === 'system'} onClick={() => setCategory('system')}><ServerCog size={13} />{copy.drawer.categories.system}</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{category === 'appearance' ? <AppearanceSettings /> : <SystemSettings onRefreshStatus={props.onRefreshStatus} runtimeStatuses={props.runtimeStatuses} onRuntimeRestart={props.onRuntimeRestart} runtimeRestarting={props.runtimeRestarting} />}</div>
      {props.onLogout && <div className="border-t border-border/70 p-4"><button onClick={props.onLogout} className="cockpit-toolbar-button w-full justify-center" data-tone="danger"><LogOut size={14} />{copy.drawer.signOut}</button></div>}
    </div>
  </>;
}
