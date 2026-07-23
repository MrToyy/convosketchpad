import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { CanvasPanel, type CanvasContextStats } from '@/features/canvas/CanvasPanel';
import { ConnectDialog } from '@/features/connect/ConnectDialog';
import { SettingsDrawer } from '@/features/settings/SettingsDrawer';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatusBar } from '@/components/StatusBar';
import { TopBar } from '@/components/TopBar';
import { useConnectionManager } from '@/hooks/useConnectionManager';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useGatewayRestart } from '@/hooks/useGatewayRestart';
import { useGateway } from '@/contexts/GatewayContext';
import { describeToolUse } from '@/utils/helpers';
import type { AgentEventPayload, AgentLogEntry, EventEntry, GatewayEvent } from '@/types';

function describeEvent(message: GatewayEvent): EventEntry {
  const payload = (message.payload || {}) as Record<string, unknown>;
  let badge = 'SYSTEM'; let badgeCls = 'badge-system'; let desc = message.event;
  if (message.event === 'chat') { badge = 'CHAT'; badgeCls = 'badge-chat'; desc = `Canvas response: ${String(payload.state || 'event')}`; }
  else if (message.event === 'agent') { badge = 'AGENT'; badgeCls = 'badge-agent'; desc = `Agent ${String(payload.state || payload.stream || 'event')}`; }
  else if (message.event.includes('error')) { badge = 'ERROR'; badgeCls = 'badge-error'; desc = String(payload.message || payload.error || message.event); }
  return { badge, badgeCls, desc, ts: new Date() };
}

export default function App({ onLogout }: { onLogout?: () => void }) {
  const { connectionState, connectError, sparkline, subscribe } = useGateway();
  const connection = useConnectionManager();
  const { tokenData } = useDashboardData();
  const restart = useGatewayRestart();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [log, setLog] = useState<AgentLogEntry[]>([]);
  const [stats, setStats] = useState<CanvasContextStats>({ branchCount: 0, sessionCount: 0 });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/agentlog', { signal: controller.signal }).then((response) => response.ok ? response.json() : []).then((entries: AgentLogEntry[]) => setLog(entries.slice().reverse().slice(0, 100))).catch(() => undefined);
    return () => controller.abort();
  }, []);
  const addLog = useCallback((entry: AgentLogEntry) => {
    setLog((current) => [entry, ...current].slice(0, 100));
    fetch('/api/agentlog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) }).catch(() => undefined);
  }, []);
  useEffect(() => subscribe((message) => {
    setEvents((current) => [describeEvent(message), ...current].slice(0, 50));
    const payload = (message.payload || {}) as AgentEventPayload;
    if (message.event === 'agent' && payload.stream === 'tool' && payload.data?.phase === 'start' && payload.data.name) addLog({ icon: '🔧', text: describeToolUse(payload.data.name, payload.data.args || {}) || payload.data.name, ts: Date.now() });
    if (message.event === 'chat') {
      const state = (message.payload as { state?: string } | undefined)?.state;
      if (state === 'final') addLog({ icon: '✅', text: 'Canvas interaction completed', ts: Date.now() });
      if (state === 'error') addLog({ icon: '❌', text: 'Canvas interaction failed', ts: Date.now() });
    }
  }), [addLog, subscribe]);

  return <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
    <TopBar onSettings={() => setSettingsOpen(true)} agentLogEntries={log} eventEntries={events} tokenData={tokenData} />
    <div className="min-h-0 flex-1 px-2 py-2 sm:px-4"><div className="shell-panel h-full overflow-hidden rounded-2xl"><CanvasPanel onContextStatsChange={setStats} /></div></div>
    <StatusBar connectionState={connectionState} branchCount={stats.branchCount} sessionCount={stats.sessionCount} sparkline={sparkline} contextTokens={stats.usedTokens} contextLimit={stats.contextLimit} />
    <ConnectDialog open={connection.dialogOpen} onConnect={connection.handleConnect} error={connectError} defaultUrl={connection.editableUrl} defaultToken={connection.editableToken} officialUrl={connection.officialUrl} serverSideAuth={connection.serverSideAuth} />
    <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} gatewayUrl={connection.editableUrl} gatewayToken={connection.editableToken} onUrlChange={connection.setEditableUrl} onTokenChange={connection.setEditableToken} onReconnect={connection.handleReconnect} connectionState={connectionState} onLogout={onLogout} onGatewayRestart={restart.handleGatewayRestart} gatewayRestarting={restart.gatewayRestarting} />
    {restart.gatewayRestartNotice && <button className={`fixed bottom-16 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border bg-card px-4 py-2 text-sm ${restart.gatewayRestartNotice.ok ? 'text-green' : 'text-destructive'}`} onClick={restart.dismissNotice}>{restart.gatewayRestartNotice.message}<X size={14} /></button>}
    <ConfirmDialog open={restart.showGatewayRestartConfirm} title="Restart OpenClaw Gateway" message="Active Canvas interactions may reconnect while the gateway restarts." confirmLabel="Restart" onConfirm={restart.confirmGatewayRestart} onCancel={restart.cancelGatewayRestart} variant="warning" />
  </div>;
}
