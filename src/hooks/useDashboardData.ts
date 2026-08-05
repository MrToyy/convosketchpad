import { useCallback, useEffect, useRef, useState } from 'react';
import type { RuntimeUsageData } from '@/types';

interface DashboardData {
  usageData: RuntimeUsageData | null;
  isLoading: boolean;
  loadError: boolean;
  ensureUsage: () => Promise<void>;
  refreshUsage: () => Promise<void>;
}

export function useDashboardData(): DashboardData {
  const [usageData, setUsageData] = useState<RuntimeUsageData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const refreshUsage = useCallback((): Promise<void> => {
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
        if (!controller.signal.aborted) setUsageData(nextData);
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

  const ensureUsage = useCallback(
    () => usageData ? Promise.resolve() : refreshUsage(),
    [refreshUsage, usageData],
  );

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  return { usageData, isLoading, loadError, ensureUsage, refreshUsage };
}
