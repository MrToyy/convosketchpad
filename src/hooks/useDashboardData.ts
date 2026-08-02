import { useCallback, useEffect, useRef, useState } from 'react';
import type { RuntimeUsageData } from '@/types';

interface DashboardData {
  tokenData: RuntimeUsageData | null;
  isLoading: boolean;
  loadError: boolean;
  ensureTokens: () => Promise<void>;
  refreshTokens: () => Promise<void>;
}

export function useDashboardData(): DashboardData {
  const [tokenData, setTokenData] = useState<RuntimeUsageData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const refreshTokens = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;

    const controller = new AbortController();
    controllerRef.current = controller;
    setIsLoading(true);
    setLoadError(false);

    const request = (async () => {
      try {
        const response = await fetch('/api/runtime/usage', { signal: controller.signal });
        if (!response.ok) throw new Error(`Usage request failed with HTTP ${response.status}`);
        const nextData = await response.json() as RuntimeUsageData;
        if (!controller.signal.aborted) setTokenData(nextData);
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.debug('[Usage] refresh failed:', error.message);
          setLoadError(true);
        }
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          inFlightRef.current = null;
        }
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();
    inFlightRef.current = request;
    return request;
  }, []);

  const ensureTokens = useCallback(
    () => tokenData ? Promise.resolve() : refreshTokens(),
    [refreshTokens, tokenData],
  );

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  return { tokenData, isLoading, loadError, ensureTokens, refreshTokens };
}
