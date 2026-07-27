import { RefreshCw, RotateCw } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import { getSettingsCopy } from './messages';

interface ConnectionSettingsProps {
  onReconnect: () => void;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  onGatewayRestart?: () => void;
  gatewayRestarting?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  connected: 'bg-green',
  connecting: 'bg-orange animate-pulse',
  reconnecting: 'bg-orange animate-pulse',
  disconnected: 'bg-red',
};

/** Settings section for gateway URL, auth token, reconnection, and gateway restart. */
export function ConnectionSettings({
  onReconnect,
  connectionState,
  onGatewayRestart,
  gatewayRestarting = false,
}: ConnectionSettingsProps) {
  const { language } = useSettings();
  const copy = getSettingsCopy(language).connection;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="cockpit-kicker">
          <span className="text-primary">◆</span>
          {copy.heading}
        </span>
      </div>

      {/* Status indicator */}
      <div className="cockpit-row">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_COLORS[connectionState]}`} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{copy.status}</p>
            <p className="text-xs text-muted-foreground">{copy.statuses[connectionState]}</p>
          </div>
        </div>
        <button
          onClick={onReconnect}
          disabled={connectionState === 'connecting' || connectionState === 'reconnecting'}
          className="cockpit-toolbar-button w-full justify-center sm:ml-auto sm:w-auto"
          title={copy.reconnectTitle}
        >
          <RefreshCw size={14} className={connectionState === 'reconnecting' ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">{copy.reconnect}</span>
        </button>
      </div>

      {/* Gateway Service */}
      {onGatewayRestart && (
        <>
          <div className="cockpit-divider my-2" />
          <div className="cockpit-row">
            <div className="min-w-0 flex-1">
              <span className="cockpit-kicker text-[0.6rem]">
                <span className="text-primary">◆</span>
                {copy.service}
              </span>
              <p className="mt-2 text-sm font-medium text-foreground">{copy.restartTitle}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {copy.restartHint}
              </p>
            </div>
            <button
              type="button"
              onClick={onGatewayRestart}
              disabled={gatewayRestarting}
              className="cockpit-toolbar-button w-full justify-center sm:w-auto"
            >
              <RotateCw size={14} aria-hidden="true" className={gatewayRestarting ? 'animate-spin' : ''} />
              {gatewayRestarting ? copy.restarting : copy.restart}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
