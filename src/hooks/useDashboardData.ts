import { useCallback, useEffect, useState } from 'react';
import { useRuntime } from '@/contexts/RuntimeContext';
import type { TokenData } from '@/types';

export function useDashboardData(): { tokenData: TokenData | null; refreshTokens: (signal?: AbortSignal) => Promise<void> } {
  const { connectionState } = useRuntime();
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const refreshTokens = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/tokens', { signal });
      if (response.ok && !signal?.aborted) setTokenData(await response.json());
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') console.debug('[Usage] refresh failed:', error.message);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const initialTimer = window.setTimeout(() => void refreshTokens(controller.signal), 0);
    const timer = window.setInterval(() => void refreshTokens(controller.signal), 60_000);
    return () => { controller.abort(); window.clearTimeout(initialTimer); window.clearInterval(timer); };
  }, [connectionState, refreshTokens]);
  return { tokenData, refreshTokens };
}
