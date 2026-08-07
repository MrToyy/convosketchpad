import { useCallback, useEffect, useRef, useState } from 'react';

export type OverallRuntimeState = 'ready' | 'degraded' | 'connecting' | 'unavailable';

export interface AgentRuntimeStatus {
  runtimeId: string;
  state: 'disconnected' | 'connecting' | 'connected';
  error?: string;
  version?: string;
  restartSupported?: boolean;
}

interface RuntimeStatus {
  overallState: OverallRuntimeState;
  runtimes: AgentRuntimeStatus[];
  updatedAt: number;
}

interface UseRuntimeEventsReturn {
  overallState: OverallRuntimeState;
  runtimeStatuses: Record<string, AgentRuntimeStatus>;
  connect: () => Promise<void>;
}

const PRODUCT_EVENT_TYPES = [
  'runtime.status_changed',
] as const;

/**
 * Product runtime transport.
 *
 * It does not open a WebSocket or implement the OpenClaw protocol; all browser
 * traffic is HTTP/SSE to ConvoSketchpad.
 */
export function useRuntimeEvents(): UseRuntimeEventsReturn {
  const [overallState, setOverallState] = useState<OverallRuntimeState>('connecting');
  const [runtimeStatuses, setRuntimeStatuses] = useState<Record<string, AgentRuntimeStatus>>({});
  const sourceRef = useRef<EventSource | null>(null);

  const applyStatus = useCallback((status: RuntimeStatus) => {
    setOverallState(status.overallState);
    setRuntimeStatuses(Object.fromEntries(status.runtimes.map((runtime) => [runtime.runtimeId, runtime])));
  }, []);

  const disconnect = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setOverallState('unavailable');
  }, []);

  const connect = useCallback(async () => {
    sourceRef.current?.close();
    setOverallState((current) => current === 'ready' || current === 'degraded' ? current : 'connecting');
    const response = await fetch('/api/runtime/status', { credentials: 'include' });
    if (!response.ok) throw new Error(`Runtime status failed (${response.status})`);
    applyStatus(await response.json() as RuntimeStatus);

    const source = new EventSource('/api/runtime/events', { withCredentials: true });
    sourceRef.current = source;
    for (const type of PRODUCT_EVENT_TYPES) {
      source.addEventListener(type, (raw) => {
        try {
          const parsed = JSON.parse((raw as MessageEvent<string>).data) as {
            payload?: Record<string, unknown>;
          } & Record<string, unknown>;
          if (type === 'runtime.status_changed') {
            applyStatus((parsed.payload || parsed) as unknown as RuntimeStatus);
          }
        } catch {
          // Ignore malformed product events; EventSource will continue.
        }
      });
    }
  }, [applyStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void connect().catch((error) => {
        console.warn(
          '[runtime] Initial status request failed:',
          error instanceof Error ? error.message : String(error),
        );
        setOverallState('unavailable');
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    overallState,
    runtimeStatuses,
    connect,
  };
}
