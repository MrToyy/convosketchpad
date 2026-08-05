import { useState } from 'react';
import { X } from 'lucide-react';
import { CanvasPanel } from '@/features/canvas/CanvasPanel';
import { SettingsDrawer } from '@/features/settings/SettingsDrawer';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatusBar } from '@/components/StatusBar';
import { TopBar } from '@/components/TopBar';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useRuntimeRestart } from '@/hooks/useRuntimeRestart';
import { useRuntime } from '@/contexts/RuntimeContext';
import { useSettings } from '@/contexts/SettingsContext';
import { getAppCopy } from '@/lib/app-messages';
import type { CanvasStatusStats } from '@/features/canvas/status';

export default function App({ onLogout }: { onLogout?: () => void }) {
  const { language } = useSettings();
  const copy = getAppCopy(language);
  const { overallState, runtimeStatuses, connect } = useRuntime();
  const {
    usageData,
    isLoading: usageLoading,
    loadError: usageError,
    ensureUsage,
    refreshUsage,
  } = useDashboardData();
  const restart = useRuntimeRestart(language);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stats, setStats] = useState<CanvasStatusStats>({ branchCount: 0, workingCount: 0 });

  return <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
    <TopBar
      onSettings={() => setSettingsOpen(true)}
      usageData={usageData}
      usageLoading={usageLoading}
      usageError={usageError}
      onUsageOpen={() => void ensureUsage()}
      onUsageRefresh={() => void refreshUsage()}
    />
    <div className="min-h-0 flex-1 px-2 py-2 sm:px-4"><div className="shell-panel h-full overflow-hidden rounded-2xl"><CanvasPanel onStatusStatsChange={setStats} /></div></div>
    <StatusBar overallState={overallState} runtimeStatuses={runtimeStatuses} branchCount={stats.branchCount} workingCount={stats.workingCount} contextTokens={stats.activeContext?.usedTokens} contextLimit={stats.activeContext?.contextLimit} />
    <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} onRefreshStatus={() => void connect()} runtimeStatuses={runtimeStatuses} onLogout={onLogout} onRuntimeRestart={restart.handleRuntimeRestart} runtimeRestarting={restart.runtimeRestarting} />
    {restart.runtimeRestartNotice && <button className={`fixed bottom-16 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border bg-card px-4 py-2 text-sm ${restart.runtimeRestartNotice.ok ? 'text-green' : 'text-destructive'}`} onClick={restart.dismissNotice}>{restart.runtimeRestartNotice.message}<X size={14} /></button>}
    <ConfirmDialog open={restart.showRuntimeRestartConfirm} title={copy.restart.title} message={copy.restart.message} confirmLabel={copy.restart.confirm} onConfirm={restart.confirmRuntimeRestart} onCancel={restart.cancelRuntimeRestart} variant="warning" />
  </div>;
}
