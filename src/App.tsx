import { useState } from 'react';
import { X } from 'lucide-react';
import { CanvasPanel, type CanvasContextStats } from '@/features/canvas/CanvasPanel';
import { SettingsDrawer } from '@/features/settings/SettingsDrawer';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatusBar } from '@/components/StatusBar';
import { TopBar } from '@/components/TopBar';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useGatewayRestart } from '@/hooks/useGatewayRestart';
import { useRuntime } from '@/contexts/RuntimeContext';
import { useSettings } from '@/contexts/SettingsContext';
import { getAppCopy } from '@/lib/app-messages';

export default function App({ onLogout }: { onLogout?: () => void }) {
  const { language } = useSettings();
  const copy = getAppCopy(language);
  const { connectionState, connect } = useRuntime();
  const { tokenData } = useDashboardData();
  const restart = useGatewayRestart(language);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stats, setStats] = useState<CanvasContextStats>({ branchCount: 0, sessionCount: 0 });

  return <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
    <TopBar onSettings={() => setSettingsOpen(true)} tokenData={tokenData} />
    <div className="min-h-0 flex-1 px-2 py-2 sm:px-4"><div className="shell-panel h-full overflow-hidden rounded-2xl"><CanvasPanel onContextStatsChange={setStats} /></div></div>
    <StatusBar connectionState={connectionState} branchCount={stats.branchCount} sessionCount={stats.sessionCount} contextTokens={stats.usedTokens} contextLimit={stats.contextLimit} />
    <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} onReconnect={() => void connect()} connectionState={connectionState} onLogout={onLogout} onGatewayRestart={restart.handleGatewayRestart} gatewayRestarting={restart.gatewayRestarting} />
    {restart.gatewayRestartNotice && <button className={`fixed bottom-16 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border bg-card px-4 py-2 text-sm ${restart.gatewayRestartNotice.ok ? 'text-green' : 'text-destructive'}`} onClick={restart.dismissNotice}>{restart.gatewayRestartNotice.message}<X size={14} /></button>}
    <ConfirmDialog open={restart.showGatewayRestartConfirm} title={copy.restart.title} message={copy.restart.message} confirmLabel={copy.restart.confirm} onConfirm={restart.confirmGatewayRestart} onCancel={restart.cancelGatewayRestart} variant="warning" />
  </div>;
}
