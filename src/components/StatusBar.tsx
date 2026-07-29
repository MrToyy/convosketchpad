import { ContextMeter } from './ContextMeter';
import { useSettings } from '@/contexts/SettingsContext';
import { getAppCopy } from '@/lib/app-messages';

interface StatusBarProps {
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  branchCount: number;
  workingCount: number;
  contextTokens?: number;
  contextLimit?: number;
}

/** Compact product status derived from backend runtime state and the selected Canvas graph. */
export function StatusBar({
  connectionState,
  branchCount,
  workingCount,
  contextTokens,
  contextLimit,
}: StatusBarProps) {
  const { language } = useSettings();
  const copy = getAppCopy(language);
  const statusColor = connectionState === 'connected'
    ? 'border-green/30 bg-green/10 text-green'
    : connectionState === 'connecting' || connectionState === 'reconnecting'
    ? 'border-orange/30 bg-orange/10 text-orange animate-pulse-dot'
    : 'border-red/30 bg-red/10 text-red';

  return (
    <div className="shell-panel mx-2 mb-2 flex min-h-10 flex-wrap items-center gap-y-1 overflow-hidden rounded-2xl px-3 py-2 text-[0.667rem] text-muted-foreground shrink-0 select-none max-[378px]:min-h-9 max-[378px]:gap-y-0.5 max-[378px]:px-2.5 max-[378px]:py-1.5 max-[378px]:text-[0.6rem] sm:mx-4 sm:mb-3 sm:flex-nowrap sm:gap-y-0 sm:overflow-x-auto sm:px-4 sm:text-[0.733rem]">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 overflow-visible whitespace-normal max-[378px]:gap-x-2 max-[378px]:gap-y-0.5 sm:flex-nowrap sm:gap-x-3 sm:gap-y-0 sm:whitespace-nowrap">
        <span
          key={connectionState}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[0.6rem] font-semibold tracking-[0.04em] max-[378px]:gap-0.5 max-[378px]:px-1.5 max-[378px]:py-0.5 max-[378px]:text-[0.533rem] sm:gap-1.5 sm:px-2.5 ${statusColor} animate-status-flash`}
        >
          <span className="text-[0.533rem] max-[378px]:text-[0.4375rem]" aria-hidden="true">●</span>
          <span>{copy.status.states[connectionState]}</span>
        </span>

        <span className="text-border max-[378px]:text-[0.533rem]">•</span>
        <span className="shrink-0 text-foreground/78 max-[378px]:text-[0.6rem]">
          <span className="font-mono tabular-nums text-foreground">{branchCount}</span>
          <span className="ml-1">{copy.status.branches}</span>
        </span>

        {workingCount > 0 && (
          <>
            <span className="text-border max-[378px]:text-[0.533rem]">•</span>
            <span className="shrink-0 text-foreground/78 max-[378px]:text-[0.6rem]">
              <span className="font-mono tabular-nums text-foreground">{workingCount}</span>
              <span className="ml-1">{copy.status.working}</span>
            </span>
          </>
        )}

        {contextTokens != null && contextLimit != null && contextLimit > 0 && (
          <>
            <span className="text-border max-[378px]:text-[0.533rem]">•</span>
            <span className="inline-flex shrink-0">
              <ContextMeter used={contextTokens} limit={contextLimit} language={language} />
            </span>
          </>
        )}
      </div>
    </div>
  );
}
