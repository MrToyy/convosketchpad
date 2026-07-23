import { useCallback, useEffect, useState } from 'react';
import { useGateway } from '@/contexts/GatewayContext';
import type { GatewayEvent, TokenData } from '@/types';

export function useDashboardData(): { tokenData: TokenData | null; refreshTokens: (signal?: AbortSignal) => Promise<void> } {
  const { connectionState, subscribe } = useGateway();
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
    if (connectionState !== 'connected') return;
    return subscribe((event: GatewayEvent) => {
      const payload = event.payload as Record<string, unknown> | undefined;
      if (event.event === 'tokens.update' || event.event === 'cost.update' || (event.event === 'chat' && payload?.state === 'final')) window.setTimeout(() => void refreshTokens(), 500);
    });
  }, [connectionState, refreshTokens, subscribe]);
  useEffect(() => {
    const controller = new AbortController();
    const initialTimer = window.setTimeout(() => void refreshTokens(controller.signal), 0);
    const timer = window.setInterval(() => void refreshTokens(controller.signal), 60_000);
    return () => { controller.abort(); window.clearTimeout(initialTimer); window.clearInterval(timer); };
  }, [refreshTokens]);
  return { tokenData, refreshTokens };
}
