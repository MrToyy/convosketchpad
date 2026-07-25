import { useEffect, useState } from 'react';

export interface ProviderLimitWindow {
  label: string;
  usedPercent: number;
  resetAt: number | null;
}

export interface ProviderLimit {
  provider: string;
  displayName: string;
  plan: string | null;
  windows: ProviderLimitWindow[];
}

export interface ProviderLimitsResponse {
  available: boolean;
  providers: ProviderLimit[];
}

const POLL_INTERVAL_MS = 5 * 60_000;

export function useProviderLimits(): ProviderLimitsResponse | null {
  const [limits, setLimits] = useState<ProviderLimitsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const response = await fetch('/api/provider-limits', { cache: 'no-store' });
        if (!response.ok) throw new Error('Provider limits request failed');
        const json = await response.json() as ProviderLimitsResponse;
        if (!cancelled) setLimits(json);
      } catch {
        if (!cancelled) setLimits({ available: false, providers: [] });
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return limits;
}
