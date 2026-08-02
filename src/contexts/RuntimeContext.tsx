/* eslint-disable react-refresh/only-export-components -- provider and hook intentionally co-located */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import {
  useRuntimeEvents,
  type BackendRuntimeStatus,
  type OverallBackendState,
} from '@/hooks/useRuntimeEvents';

interface RuntimeContextValue {
  overallState: OverallBackendState;
  backendStatuses: Record<string, BackendRuntimeStatus>;
  connect: () => Promise<void>;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const {
    overallState,
    backendStatuses,
    connect: connectRuntime,
  } = useRuntimeEvents();
  const connect = useCallback(async () => {
    await connectRuntime();
  }, [connectRuntime]);
  const value = useMemo<RuntimeContextValue>(() => ({
    overallState,
    backendStatuses,
    connect,
  }), [backendStatuses, connect, overallState]);
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useRuntime() {
  const context = useContext(RuntimeContext);
  if (!context) throw new Error('useRuntime must be used within RuntimeProvider');
  return context;
}
