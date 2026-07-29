import { RefreshCw, RotateCw } from 'lucide-react';
import { UpdateBadge } from '@/components/UpdateBadge';
import { useSettings } from '@/contexts/SettingsContext';
import { getSettingsCopy } from './messages';

interface SystemSettingsProps {
  onReconnect: () => void;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  gatewayRestartSupported: boolean;
  onGatewayRestart?: () => void;
  gatewayRestarting?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  connected: 'bg-green',
  connecting: 'bg-orange animate-pulse',
  reconnecting: 'bg-orange animate-pulse',
  disconnected: 'bg-red',
};

/** Settings sections for OpenClaw Gateway management and ConvoSketchpad updates. */
export function SystemSettings({
  onReconnect,
  connectionState,
  gatewayRestartSupported,
  onGatewayRestart,
  gatewayRestarting = false,
}: SystemSettingsProps) {
  const { language } = useSettings();
  const copy = getSettingsCopy(language).system;

  return (
    <div className="space-y-6">
      <section aria-labelledby="openclaw-gateway-settings" className="space-y-3">
        <h2 id="openclaw-gateway-settings" className="cockpit-kicker">
          <span aria-hidden="true" className="text-primary">◆</span>
          {copy.gatewayHeading}
        </h2>

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

        {gatewayRestartSupported && onGatewayRestart ? (
          <div className="cockpit-row">
            <div className="min-w-0 flex-1">
              <span className="cockpit-kicker text-[0.6rem]">
                <span aria-hidden="true" className="text-primary">◆</span>
                {copy.gatewayService}
              </span>
              <p className="mt-2 text-sm font-medium text-foreground">{copy.restartTitle}</p>
              <p className="mt-1 text-xs text-muted-foreground">{copy.restartHint}</p>
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
        ) : !gatewayRestartSupported ? (
          <div className="cockpit-row">
            <div className="min-w-0 flex-1">
              <span className="cockpit-kicker text-[0.6rem]">
                <span aria-hidden="true" className="text-primary">◆</span>
                {copy.gatewayService}
              </span>
              <p className="mt-2 text-sm font-medium text-foreground">{copy.remoteGatewayTitle}</p>
              <p className="mt-1 text-xs text-muted-foreground">{copy.remoteGatewayHint}</p>
            </div>
          </div>
        ) : null}
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
