import { RefreshCw, RotateCw } from 'lucide-react';
import { UpdateBadge } from '@/components/UpdateBadge';
import { useSettings } from '@/contexts/SettingsContext';
import type { BackendRuntimeStatus } from '@/hooks/useRuntimeEvents';
import { getSettingsCopy } from './messages';

interface SystemSettingsProps {
  onRefreshStatus: () => void;
  backendStatuses: Record<string, BackendRuntimeStatus>;
  onBackendRestart?: (backendId: string) => void;
  backendRestarting?: boolean;
}

const STATUS_COLORS: Record<BackendRuntimeStatus['state'], string> = {
  connected: 'bg-green',
  connecting: 'bg-orange animate-pulse',
  disconnected: 'bg-red',
};

/** Settings for configured Agent Backends and ConvoSketchpad updates. */
export function SystemSettings({
  onRefreshStatus,
  backendStatuses,
  onBackendRestart,
  backendRestarting = false,
}: SystemSettingsProps) {
  const { language } = useSettings();
  const copy = getSettingsCopy(language).system;
  const statuses = Object.values(backendStatuses);

  return (
    <div className="space-y-6">
      <section aria-labelledby="agent-backend-settings" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="agent-backend-settings" className="cockpit-kicker">
            <span aria-hidden="true" className="text-primary">◆</span>
            Agent Backends
          </h2>
          <button type="button" onClick={onRefreshStatus} className="cockpit-toolbar-button" title={language === 'zh-CN' ? '刷新状态' : 'Refresh status'}>
            <RefreshCw size={14} />
            <span className="hidden sm:inline">{language === 'zh-CN' ? '刷新状态' : 'Refresh'}</span>
          </button>
        </div>

        {statuses.length === 0 && (
          <div className="cockpit-row text-sm text-muted-foreground">
            {language === 'zh-CN' ? '没有已配置的 Agent Backend' : 'No Agent Backends configured'}
          </div>
        )}

        {statuses.map((backend) => (
          <div key={backend.backendId} className="cockpit-row">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_COLORS[backend.state]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{backend.backendId}</p>
                <p className="text-xs text-muted-foreground">
                  {backend.state}{backend.version ? ` · v${backend.version}` : ''}
                </p>
                {backend.error && (
                  <p className="mt-1 truncate text-xs text-destructive" title={backend.error}>{backend.error}</p>
                )}
              </div>
            </div>
            {backend.restartSupported && onBackendRestart && (
              <button
                type="button"
                onClick={() => onBackendRestart(backend.backendId)}
                disabled={backendRestarting}
                className="cockpit-toolbar-button w-full justify-center sm:w-auto"
              >
                <RotateCw size={14} aria-hidden="true" className={backendRestarting ? 'animate-spin' : ''} />
                {backendRestarting ? copy.restarting : copy.restart}
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
