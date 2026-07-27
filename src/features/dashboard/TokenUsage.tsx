import { RefreshCw } from 'lucide-react';
import type { TokenData } from '@/types';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { fmtTokens } from '@/lib/formatting';
import { useProviderLimits } from './useProviderLimits';
import type { ProviderLimit } from './useProviderLimits';
import { useSettings } from '@/contexts/SettingsContext';
import { getAppCopy, type AppCopy } from '@/lib/app-messages';
import type { Language } from '@/lib/language';

// ── Reset time formatting helpers ───────────────────────────────────

function formatResetTime(tsMs: number, language: Language, opts: { withDate?: boolean } = {}): string {
  const d = new Date(tsMs);
  if (opts.withDate) {
    return d.toLocaleString(language, {
      month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }
  return d.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', hour12: false });
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

function LimitProgressBar({ label, usedPercent, barClass, resetText, copy }: {
  label: string;
  usedPercent: number;
  barClass: string;
  resetText?: string;
  copy: AppCopy;
}) {
  return (
    <div className="flex flex-col gap-0.5 mb-1.5">
      <div className="flex items-baseline justify-between text-[0.733rem]">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground font-mono font-bold">{usedPercent.toFixed(0)}% {copy.usage.used}</span>
      </div>
      <div className="h-1.5 bg-background border border-border/60 overflow-hidden">
        <div
          className={`h-full ${barClass} transition-all duration-700`}
          style={{ width: `${Math.min(100, Math.max(0, usedPercent))}%` }}
        />
      </div>
      {resetText && <div className="text-[0.733rem] text-muted-foreground/60">{copy.usage.resets} {resetText}</div>}
    </div>
  );
}

function formatProviderWindowLabel(label: string, copy: AppCopy, language: Language): string {
  const normalised = label.trim().toLowerCase();
  if (normalised === '168h' || normalised === '7d' || normalised === 'weekly') return copy.usage.weeklyLimit;
  if (language === 'zh-CN') return copy.usage.limit(label.replace(/\s*limit$/i, ''));
  return normalised.endsWith('limit') ? label : copy.usage.limit(label);
}

function ProviderLimitsBlock({ providers, available, copy, language }: {
  providers: ProviderLimit[];
  available: boolean | null;
  copy: AppCopy;
  language: Language;
}) {
  if (available === null) {
    return (
      <div className="pt-1.5 text-[0.733rem] text-muted-foreground/50 animate-pulse">
        {copy.usage.loadingLimits}
      </div>
    );
  }
  if (!available) {
    return (
      <div className="pt-1.5 text-[0.733rem] text-muted-foreground/40">
        {copy.usage.limitsUnavailable}
      </div>
    );
  }
  if (providers.length === 0) {
    return (
      <div className="pt-1.5 text-[0.733rem] text-muted-foreground/40">
        {copy.usage.noLimits}
      </div>
    );
  }

  return providers.map((provider) => {
    const icon = PROVIDER_ICONS[provider.provider] || '●';
    const barClass = PROVIDER_BAR_CLASSES[provider.provider] || DEFAULT_BAR_CLASS;
    return (
      <div key={provider.provider} className="pt-2 mt-1 border-t border-border/40">
        <div className="text-[0.733rem] text-muted-foreground uppercase tracking-[1px] flex items-center gap-1.5 mb-1">
          <span>{icon}</span>
          {copy.usage.providerLimits(provider.displayName)}
          {provider.plan && (
            <span className="ml-auto normal-case tracking-normal text-muted-foreground/50">{provider.plan}</span>
          )}
        </div>
        <div className="mt-2 rounded-xl border border-border/45 bg-background/45 px-2.5 py-2">
          {provider.windows.length > 0
            ? provider.windows.map((window) => (
                <LimitProgressBar
                  key={`${provider.provider}:${window.label}`}
                  label={formatProviderWindowLabel(window.label, copy, language)}
                  usedPercent={window.usedPercent}
                  barClass={barClass}
                  resetText={window.resetAt ? formatResetTime(window.resetAt, language, { withDate: true }) : undefined}
                  copy={copy}
                />
              ))
            : <div className="text-[0.733rem] text-muted-foreground">{copy.usage.noLimitDetails}</div>}
        </div>
      </div>
    );
  });
}

// ── Main component ───────────────────────────────────────────────────

interface TokenUsageProps {
  data: TokenData | null;
  loading: boolean;
  error: boolean;
  onRefresh: () => void;
}

/** Gateway-wide token usage plus independently sourced Provider quotas. */
export function TokenUsage({ data, loading, error, onRefresh }: TokenUsageProps) {
  const { language } = useSettings();
  const copy = getAppCopy(language);
  const providerLimits = useProviderLimits();
  const totalCostCents = Math.round((data?.totalCost ?? 0) * 100);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="panel-header border-l-[3px] border-l-primary">
        <span className="panel-label text-primary">
          <span className="panel-diamond">◆</span>
          {copy.usage.heading}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label={copy.usage.refresh}
          title={copy.usage.refresh}
          className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-2.5 flex flex-col gap-1">
          <div className="text-[0.733rem] font-semibold uppercase tracking-[1px] text-muted-foreground">
            {copy.usage.gatewayUsage}
          </div>
          {!data ? (
            <div className="py-2 text-[0.733rem] text-muted-foreground">
              {error ? copy.usage.refreshFailed : copy.usage.loading}
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <AnimatedNumber
                  value={totalCostCents}
                  format={(n) => '$' + (n / 100).toFixed(2)}
                  className="text-xl font-bold text-primary [text-shadow:0_0_8px_rgba(232,168,56,0.3)]"
                  duration={800}
                />
                <span className="text-[0.733rem] uppercase tracking-[1px] text-muted-foreground">{copy.usage.allTime}</span>
              </div>
              <div className="text-[0.667rem] text-muted-foreground/60">{copy.usage.billableTokensOnly}</div>
              {error && (
                <div className="text-[0.667rem] text-destructive">{copy.usage.refreshFailed}</div>
              )}
              <div className="mt-1 flex flex-wrap gap-3 border-t border-border/40 pt-1.5 text-[0.733rem] text-muted-foreground">
                <span>
                  ↑ <AnimatedNumber value={data.totalInput} format={fmtTokens} className="text-foreground" duration={600} />{' '}
                  {copy.usage.input}
                </span>
                <span>
                  ↓ <AnimatedNumber value={data.totalOutput} format={fmtTokens} className="text-foreground" duration={600} />{' '}
                  {copy.usage.output}
                </span>
                <span>
                  📦 <AnimatedNumber value={data.totalCacheRead} format={fmtTokens} className="text-foreground" duration={600} />{' '}
                  {copy.usage.cached}
                </span>
              </div>
            </>
          )}

          <div className="mt-2 border-t border-border/50 pt-2">
            <div className="text-[0.733rem] font-semibold uppercase tracking-[1px] text-muted-foreground">
              {copy.usage.providerQuotas}
            </div>
            <ProviderLimitsBlock
              providers={providerLimits?.providers ?? []}
              available={providerLimits?.available ?? null}
              copy={copy}
              language={language}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
