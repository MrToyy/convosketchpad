import { useState, useMemo } from 'react';
import type { TokenData, TokenEntry } from '@/types';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { fmtTokens } from '@/lib/formatting';
import { useProviderLimits } from './useProviderLimits';
import type { ProviderLimit } from './useProviderLimits';

// ── Reset time formatting helpers ───────────────────────────────────

function formatResetTime(tsMs: number, opts: { withDate?: boolean } = {}): string {
  const d = new Date(tsMs);
  if (opts.withDate) {
    return d.toLocaleString('en-GB', {
      month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── Provider icons & colors ──────────────────────────────────────────

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: '🟣',
  'openai-codex': '⚡',
  openai: '🟢',
  google: '🔵',
  gemini: '🔵',
};

const PROVIDER_BAR_CLASSES: Record<string, string> = {
  anthropic: 'bg-purple shadow-[0_0_4px_rgba(155,89,182,0.4)]',
  'openai-codex': 'bg-green shadow-[0_0_4px_rgba(76,175,80,0.4)]',
  openai: 'bg-green shadow-[0_0_4px_rgba(76,175,80,0.4)]',
};

const DEFAULT_BAR_CLASS = 'bg-primary shadow-[0_0_8px_rgba(232,168,56,0.3)]';

// ── Shared limit bar (presentational) ────────────────────────────────

function LimitProgressBar({ label, usedPercent, barClass, resetText }: {
  label: string;
  usedPercent: number;
  barClass: string;
  resetText?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 mb-1.5">
      <div className="flex items-baseline justify-between text-[0.733rem]">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground font-mono font-bold">{usedPercent.toFixed(0)}% used</span>
      </div>
      <div className="h-1.5 bg-background border border-border/60 overflow-hidden">
        <div
          className={`h-full ${barClass} transition-all duration-700`}
          style={{ width: `${Math.min(100, Math.max(0, usedPercent))}%` }}
        />
      </div>
      {resetText && <div className="text-[0.733rem] text-muted-foreground/60">resets {resetText}</div>}
    </div>
  );
}

function formatProviderWindowLabel(label: string): string {
  const normalised = label.trim().toLowerCase();
  if (normalised === '168h' || normalised === '7d' || normalised === 'weekly') return 'Weekly limit';
  return normalised.endsWith('limit') ? label : `${label} limit`;
}

function ProviderLimitsBlock({ providers, available }: {
  providers: ProviderLimit[];
  available: boolean | null;
}) {
  if (available === null) {
    return (
      <div className="pt-1.5 mt-1 border-t border-border/30 text-[0.733rem] text-muted-foreground/50 animate-pulse">
        Loading Provider limits…
      </div>
    );
  }
  if (!available) {
    return (
      <div className="pt-1.5 mt-1 border-t border-border/30 text-[0.733rem] text-muted-foreground/40">
        Provider limits unavailable
      </div>
    );
  }
  if (providers.length === 0) {
    return (
      <div className="pt-1.5 mt-1 border-t border-border/30 text-[0.733rem] text-muted-foreground/40">
        No provider limits reported
      </div>
    );
  }

  return providers.map((provider) => {
    const icon = PROVIDER_ICONS[provider.provider] || '●';
    const barClass = PROVIDER_BAR_CLASSES[provider.provider] || DEFAULT_BAR_CLASS;
    return (
      <div key={provider.provider} className="pt-1.5 mt-1 border-t border-border/30">
        <div className="text-[0.733rem] text-muted-foreground uppercase tracking-[1px] flex items-center gap-1.5 mb-1">
          <span>{icon}</span>
          {provider.displayName} limits
          {provider.plan && (
            <span className="ml-auto normal-case tracking-normal text-muted-foreground/50">{provider.plan}</span>
          )}
        </div>
        {provider.windows.map((window) => (
          <LimitProgressBar
            key={`${provider.provider}:${window.label}`}
            label={formatProviderWindowLabel(window.label)}
            usedPercent={window.usedPercent}
            barClass={barClass}
            resetText={window.resetAt ? formatResetTime(window.resetAt, { withDate: true }) : undefined}
          />
        ))}
      </div>
    );
  });
}

// ── Expandable provider row ──────────────────────────────────────────

function ProviderRow({
  entry,
  maxCost,
}: {
  entry: TokenEntry;
  maxCost: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const pct = Math.max(2, (entry.cost / maxCost) * 100);
  const barClass = PROVIDER_BAR_CLASSES[entry.source] || DEFAULT_BAR_CLASS;
  const costCents = Math.round(entry.cost * 100);
  const icon = PROVIDER_ICONS[entry.source] || '●';
  const avgCost = entry.messageCount ? entry.cost / entry.messageCount : 0;

  return (
    <div className="flex flex-col">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`${entry.source} provider details`}
        className="flex items-center gap-2 text-[0.733rem] w-full hover:bg-muted/30 rounded px-0.5 py-0.5 transition-colors cursor-pointer group"
      >
        <span className="w-3.5 text-center shrink-0 text-xs flex items-center justify-center">{icon}</span>
        <span className="text-foreground text-[0.733rem] font-bold w-16 shrink-0 uppercase tracking-[0.5px]">
          {entry.source}
        </span>
        <div className="flex-1 h-2 bg-background border border-border/60 overflow-hidden">
          <div
            className={`h-full ${barClass}`}
            style={{
              width: `${pct}%`,
              transition: 'width 700ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
            }}
          />
        </div>
        <AnimatedNumber
          value={costCents}
          format={(n) => '$' + (n / 100).toFixed(2)}
          className="text-muted-foreground text-[0.733rem] w-13 text-right shrink-0"
          duration={600}
        />
        <span
          className={`text-[0.667rem] transition-transform duration-150 ${expanded ? 'rotate-180' : ''} text-muted-foreground/50 group-hover:text-muted-foreground`}
        >
          ▼
        </span>
      </button>

      {expanded && (
        <div className="pl-6 pr-1 pb-1.5 pt-0.5 flex flex-col gap-1 border-l-2 border-border/30 ml-[7px]">
          {/* Token breakdown */}
          <div className="flex gap-3 text-[0.733rem] text-muted-foreground flex-wrap">
            <span>
              ↑ <span className="text-foreground">{fmtTokens(entry.inputTokens || 0)}</span> in
            </span>
            <span>
              ↓ <span className="text-foreground">{fmtTokens(entry.outputTokens || 0)}</span> out
            </span>
            {(entry.cacheReadTokens || 0) > 0 && (
              <span>
                📦 <span className="text-foreground">{fmtTokens(entry.cacheReadTokens || 0)}</span> cached
              </span>
            )}
          </div>

          {/* Message stats */}
          <div className="flex gap-3 text-[0.733rem] text-muted-foreground flex-wrap">
            <span>
              💬 <span className="text-foreground">{(entry.messageCount || 0).toLocaleString()}</span> msgs
            </span>
            <span>
              avg <span className="text-foreground">${avgCost.toFixed(4)}</span>/msg
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

interface TokenUsageProps {
  data: TokenData | null;
}

/** Dashboard widget displaying token usage breakdown with visual bars. */
export function TokenUsage({ data }: TokenUsageProps) {
  const entries = useMemo(
    () =>
      (data?.entries || []).filter(
        (e) => e.cost > 0 || (e.messageCount || 0) > 0,
      ),
    [data?.entries],
  );
  const maxCost = useMemo(() => Math.max(1, ...entries.map((e) => e.cost)), [entries]);
  const providerLimits = useProviderLimits();

  if (!data) {
    return (
      <div className="h-full flex flex-col min-h-0">
        <div className="panel-header border-l-[3px] border-l-primary">
          <span className="panel-label text-primary">
            <span className="panel-diamond">◆</span>
            USAGE
          </span>
        </div>
        <div className="p-3 text-muted-foreground text-[0.667rem]">Loading…</div>
      </div>
    );
  }

  const totalCostCents = Math.round((data.totalCost ?? 0) * 100);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="panel-header border-l-[3px] border-l-primary">
        <span className="panel-label text-primary">
          <span className="panel-diamond">◆</span>
          USAGE
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-2.5 flex flex-col gap-1">
          {/* ── Accumulated cost ───────────────────────────────── */}
          <div className="flex items-baseline gap-2 pb-1.5 border-b border-border/40 mb-0.5">
            <AnimatedNumber
              value={totalCostCents}
              format={(n) => '$' + (n / 100).toFixed(2)}
              className="text-xl font-bold text-primary [text-shadow:0_0_8px_rgba(232,168,56,0.3)]"
              duration={800}
            />
            <span className="text-[0.733rem] text-muted-foreground uppercase tracking-[1px]">all-time</span>
          </div>

          {/* ── Per-provider expandable rows ───────────────────── */}
          {entries.length > 0 ? (
            entries.map((e) => (
              <ProviderRow
                key={e.source}
                entry={e}
                maxCost={maxCost}
              />
            ))
          ) : data.breakdownAvailable === false ? (
            <div className="text-[0.733rem] text-muted-foreground/50 italic">Provider breakdown unavailable</div>
          ) : (
            <div className="text-[0.733rem] text-muted-foreground/50 italic">No usage data</div>
          )}

          {/* ── OpenClaw-native Provider quota windows ─────────── */}
          <ProviderLimitsBlock
            providers={providerLimits?.providers ?? []}
            available={providerLimits?.available ?? null}
          />

          {/* ── Aggregate token stats ──────────────────────────── */}
          <div className="flex gap-3 pt-1.5 mt-0.5 border-t border-border/40 text-[0.733rem] text-muted-foreground flex-wrap">
            <span>
              ↑{' '}
              <AnimatedNumber
                value={data.totalInput || 0}
                format={fmtTokens}
                className="text-foreground"
                duration={600}
              />{' '}
              in
            </span>
            <span>
              ↓{' '}
              <AnimatedNumber
                value={data.totalOutput || 0}
                format={fmtTokens}
                className="text-foreground"
                duration={600}
              />{' '}
              out
            </span>
            {(data.totalMessages ?? 0) > 0 && (
              <span>
                💬{' '}
                <AnimatedNumber
                  value={data.totalMessages || 0}
                  format={(n) => n.toLocaleString()}
                  className="text-foreground"
                  duration={600}
                />{' '}
                msgs
              </span>
            )}
            {(data.totalErrors ?? 0) > 0 && (
              <span className="text-red">
                ⚠ <span className="font-bold">{data.totalErrors?.toLocaleString()}</span> errors
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
