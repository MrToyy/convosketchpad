import { RefreshCw } from 'lucide-react';
import type { ProviderLimit, RuntimeUsageData } from '@/types';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { fmtTokens } from '@/lib/formatting';
import { useSettings } from '@/contexts/SettingsContext';
import { getAppCopy, type AppCopy } from '@/lib/app-messages';
import type { Language } from '@/lib/language';

function formatResetTime(timestamp: number, language: Language): string {
  return new Date(timestamp).toLocaleString(language, {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function LimitProgressBar({ label, usedPercent, resetAt, copy, language }: {
  label: string;
  usedPercent: number;
  resetAt: number | null;
  copy: AppCopy;
  language: Language;
}) {
  return <div className="mb-1.5 flex flex-col gap-0.5">
    <div className="flex items-baseline justify-between text-[0.733rem]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-bold text-foreground">{usedPercent.toFixed(0)}% {copy.usage.used}</span>
    </div>
    <div className="h-1.5 overflow-hidden border border-border/60 bg-background">
      <div className="h-full bg-primary transition-all duration-700" style={{ width: `${Math.min(100, Math.max(0, usedPercent))}%` }} />
    </div>
    {resetAt != null && <div className="text-[0.667rem] text-muted-foreground/60">{copy.usage.resets} {formatResetTime(resetAt, language)}</div>}
  </div>;
}

function ProviderQuotas({ providers, copy, language }: {
  providers: ProviderLimit[];
  copy: AppCopy;
  language: Language;
}) {
  if (providers.length === 0) return <div className="text-[0.733rem] text-muted-foreground/50">{copy.usage.noLimits}</div>;
  return providers.map((provider) => <div key={provider.provider} className="mt-2 border-t border-border/40 pt-2">
    <div className="mb-1 text-[0.733rem] font-semibold text-muted-foreground">
      {copy.usage.providerLimits(provider.displayName)}
      {provider.plan && <span className="ml-2 font-normal text-muted-foreground/50">{provider.plan}</span>}
    </div>
    {provider.windows.length > 0
      ? provider.windows.map((window) => <LimitProgressBar key={`${provider.provider}:${window.label}`} label={window.label} usedPercent={window.usedPercent} resetAt={window.resetAt} copy={copy} language={language} />)
      : <div className="text-[0.733rem] text-muted-foreground/50">{copy.usage.noLimitDetails}</div>}
  </div>);
}

interface TokenUsageProps {
  data: RuntimeUsageData | null;
  loading: boolean;
  error: boolean;
  onRefresh: () => void;
}

/** Per-Runtime account usage. Values are never merged unless the server marks costs comparable. */
export function TokenUsage({ data, loading, error, onRefresh }: TokenUsageProps) {
  const { language } = useSettings();
  const copy = getAppCopy(language);
  return <div className="flex h-full min-h-0 flex-col">
    <div className="panel-header border-l-[3px] border-l-primary">
      <span className="panel-label text-primary"><span className="panel-diamond">◆</span>{copy.usage.heading}</span>
      <button type="button" onClick={onRefresh} disabled={loading} aria-label={copy.usage.refresh} title={copy.usage.refresh} className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-50">
        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
      </button>
    </div>
    <div className="flex-1 overflow-y-auto px-3 py-2.5">
      {error && data && <div role="status" className="mb-2 rounded-lg border border-orange/30 bg-orange/10 px-2 py-1.5 text-[0.733rem] text-orange">{language === 'zh-CN' ? '刷新用量失败，当前显示上次结果。' : 'Usage refresh failed; showing the last result.'}</div>}
      {!data ? <div className="py-2 text-[0.733rem] text-muted-foreground">{error ? copy.usage.refreshFailed : copy.usage.loading}</div> : <div className="space-y-3">
        {data.comparableCostTotal && <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
          <div className="text-[0.667rem] uppercase tracking-[1px] text-muted-foreground">{language === 'zh-CN' ? '可比较费用合计' : 'Comparable cost total'}</div>
          <div className="mt-1 text-xl font-bold text-primary">{data.comparableCostTotal.currency === 'USD' ? '$' : `${data.comparableCostTotal.currency} `}{data.comparableCostTotal.amount.toFixed(2)}</div>
        </div>}
        {data.runtimes.map((runtime) => <section key={runtime.runtimeId} className="rounded-xl border border-border/60 bg-background/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div><div className="text-sm font-semibold text-foreground">{runtime.displayName}</div><div className="text-[0.667rem] text-muted-foreground">{runtime.runtimeId}</div></div>
            <span className={`text-[0.667rem] ${runtime.available ? 'text-green' : 'text-destructive'}`}>{runtime.available ? (language === 'zh-CN' ? '可用' : 'Available') : (language === 'zh-CN' ? '不可用' : 'Unavailable')}</span>
          </div>
          {runtime.usage && <div className="mt-2 border-t border-border/40 pt-2">
            <div className="flex items-baseline gap-2"><span className="text-lg font-bold text-primary">{runtime.usage.currency === 'USD' ? '$' : `${runtime.usage.currency || ''} `}{runtime.usage.totalCost.toFixed(2)}</span><span className="text-[0.667rem] text-muted-foreground">{runtime.usage.period || 'unknown'}</span></div>
            <div className="mt-1 flex flex-wrap gap-3 text-[0.733rem] text-muted-foreground">
              <span>↑ <AnimatedNumber value={runtime.usage.totalInput} format={fmtTokens} className="text-foreground" /> {copy.usage.input}</span>
              <span>↓ <AnimatedNumber value={runtime.usage.totalOutput} format={fmtTokens} className="text-foreground" /> {copy.usage.output}</span>
              <span>📦 <AnimatedNumber value={runtime.usage.totalCacheRead} format={fmtTokens} className="text-foreground" /> {copy.usage.cached}</span>
            </div>
          </div>}
          {runtime.quotas?.available && <div className="mt-2 border-t border-border/40 pt-2"><ProviderQuotas providers={runtime.quotas.providers} copy={copy} language={language} /></div>}
          {!runtime.usage && !runtime.quotas?.available && <div className="mt-2 text-[0.733rem] text-muted-foreground/60">{runtime.error || (language === 'zh-CN' ? '此运行端不提供用量数据' : 'This Runtime does not provide usage data')}</div>}
        </section>)}
        {data.runtimes.length === 0 && <div className="py-2 text-[0.733rem] text-muted-foreground">{language === 'zh-CN' ? '没有已配置的 Agent 运行端' : 'No Agent Runtimes configured'}</div>}
      </div>}
    </div>
  </div>;
}
