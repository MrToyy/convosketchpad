import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Settings } from 'lucide-react';
import ConvoSketchpadLogo from './ConvoSketchpadLogo';
import { TokenUsage } from '@/features/dashboard/TokenUsage';
import { useSettings } from '@/contexts/SettingsContext';
import { getAppCopy } from '@/lib/app-messages';
import type { RuntimeUsageData } from '@/types';

type Panel = 'usage' | null;
interface TopBarProps {
  onSettings: () => void;
  tokenData: RuntimeUsageData | null;
  usageLoading: boolean;
  usageError: boolean;
  onUsageOpen: () => void;
  onUsageRefresh: () => void;
}

export function TopBar({
  onSettings,
  tokenData,
  usageLoading,
  usageError,
  onUsageOpen,
  onUsageRefresh,
}: TopBarProps) {
  const { language } = useSettings();
  const copy = getAppCopy(language);
  const [panel, setPanel] = useState<Panel>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panel) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setPanel(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [panel]);
  const cost = useMemo(() => tokenData?.comparableCostTotal
    ? `${tokenData.comparableCostTotal.currency === 'USD' ? '$' : `${tokenData.comparableCostTotal.currency} `}${tokenData.comparableCostTotal.amount.toFixed(2)}`
    : null, [tokenData]);
  const toggleUsage = () => {
    const opening = panel !== 'usage';
    setPanel(opening ? 'usage' : null);
    if (opening) onUsageOpen();
  };
  return <div ref={rootRef} className="relative z-40 px-2 pt-2 sm:px-4 sm:pt-3">
    <header className="shell-panel flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2 sm:px-4">
      <div className="flex size-10 items-center justify-center rounded-2xl border border-primary/20 bg-background/55"><ConvoSketchpadLogo size={24} /></div>
      <div><div className="font-semibold tracking-[0.06em] text-primary">ConvoSketchpad</div><div className="hidden text-xs text-muted-foreground sm:block">{copy.tagline}</div></div>
      <div className="ml-auto flex gap-2">
        <button type="button" className="shell-icon-button" data-active={panel === 'usage'} onClick={toggleUsage}><BarChart3 size={14} /><span className="hidden sm:inline">{copy.topBar.usage}</span>{cost && <span className="hidden text-xs lg:inline">{cost}</span>}</button>
        <button type="button" aria-label={copy.topBar.settings} className="shell-icon-button" onClick={onSettings}><Settings size={14} /></button>
      </div>
    </header>
    {panel && <div className="shell-panel absolute right-2 mt-2 max-h-[420px] w-[480px] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl sm:right-4"><TokenUsage data={tokenData} loading={usageLoading} error={usageError} onRefresh={onUsageRefresh} /></div>}
  </div>;
}
