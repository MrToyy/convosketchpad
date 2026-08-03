import { RefreshCw, RotateCw } from 'lucide-react';
import { UpdateBadge } from '@/components/UpdateBadge';
import { useSettings } from '@/contexts/SettingsContext';
import type { AgentRuntimeStatus } from '@/hooks/useRuntimeEvents';
import { getSettingsCopy } from './messages';

interface SystemSettingsProps {
  onRefreshStatus: () => void;
  runtimeStatuses: Record<string, AgentRuntimeStatus>;
  onRuntimeRestart?: (runtimeId: string) => void;
  runtimeRestarting?: boolean;
}

const STATUS_COLORS: Record<AgentRuntimeStatus['state'], string> = {
  connected: 'bg-green',
  connecting: 'bg-orange animate-pulse',
  disconnected: 'bg-red',
};

/** Settings for configured Agent Runtimes and ConvoSketchpad updates. */
export function SystemSettings({
  onRefreshStatus,
  runtimeStatuses,
  onRuntimeRestart,
  runtimeRestarting = false,
}: SystemSettingsProps) {
  const { language } = useSettings();
  const copy = getSettingsCopy(language).system;
  const statuses = Object.values(runtimeStatuses);

  return (
    <div className="space-y-6">
      <section aria-labelledby="agent-runtime-settings" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="agent-runtime-settings" className="cockpit-kicker">
            <span aria-hidden="true" className="text-primary">◆</span>
            {language === 'zh-CN' ? 'Agent 运行端' : 'Agent Runtimes'}
          </h2>
          <button type="button" onClick={onRefreshStatus} className="cockpit-toolbar-button" title={language === 'zh-CN' ? '刷新状态' : 'Refresh status'}>
            <RefreshCw size={14} />
            <span className="hidden sm:inline">{language === 'zh-CN' ? '刷新状态' : 'Refresh'}</span>
          </button>
        </div>

        {statuses.length === 0 && (
          <div className="cockpit-row text-sm text-muted-foreground">
            {language === 'zh-CN' ? '没有已配置的 Agent 运行端' : 'No Agent Runtimes configured'}
          </div>
        )}

        {statuses.map((runtime) => (
          <div key={runtime.runtimeId} className="cockpit-row">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_COLORS[runtime.state]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{runtime.runtimeId}</p>
                <p className="text-xs text-muted-foreground">
                  {runtime.state}{runtime.version ? ` · v${runtime.version}` : ''}
                </p>
                {runtime.error && (
                  <p className="mt-1 truncate text-xs text-destructive" title={runtime.error}>{runtime.error}</p>
                )}
              </div>
            </div>
            {runtime.restartSupported && onRuntimeRestart && (
              <button
                type="button"
                onClick={() => onRuntimeRestart(runtime.runtimeId)}
                disabled={runtimeRestarting}
                className="cockpit-toolbar-button w-full justify-center sm:w-auto"
              >
                <RotateCw size={14} aria-hidden="true" className={runtimeRestarting ? 'animate-spin' : ''} />
                {runtimeRestarting ? copy.restarting : copy.restart}
              </button>
            )}
          </div>
        ))}
      </section>

      <section aria-labelledby="convosketchpad-settings" className="space-y-3">
        <h2 id="convosketchpad-settings" className="cockpit-kicker">
          <span aria-hidden="true" className="text-primary">◆</span>
          {copy.applicationHeading}
        </h2>
        <div className="cockpit-row">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">ConvoSketchpad</p>
            <p className="mt-1 text-xs text-muted-foreground">{copy.version} v{__APP_VERSION__}</p>
          </div>
          <UpdateBadge />
        </div>
      </section>
    </div>
  );
}
