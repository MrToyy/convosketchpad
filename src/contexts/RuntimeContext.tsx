/* eslint-disable react-refresh/only-export-components -- provider and hook intentionally co-located */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useRuntimeEvents } from '@/hooks/useRuntimeEvents';

interface RuntimeContextValue {
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  gatewayRestartSupported: boolean;
  connect: () => Promise<void>;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const {
    connectionState,
    gatewayRestartSupported,
    connect: connectRuntime,
  } = useRuntimeEvents();
  const connect = useCallback(async () => {
    await connectRuntime();
  }, [connectRuntime]);
  const value = useMemo<RuntimeContextValue>(() => ({
    connectionState,
    gatewayRestartSupported,
    connect,
  }), [connect, connectionState, gatewayRestartSupported]);
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useRuntime() {
  const context = useContext(RuntimeContext);
  if (!context) throw new Error('useRuntime must be used within RuntimeProvider');
  return context;
}
