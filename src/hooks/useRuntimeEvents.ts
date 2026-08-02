import { useCallback, useEffect, useRef, useState } from 'react';

export type OverallBackendState = 'ready' | 'degraded' | 'connecting' | 'unavailable';

export interface BackendRuntimeStatus {
  backendId: string;
  state: 'disconnected' | 'connecting' | 'connected';
  error?: string;
  version?: string;
  restartSupported?: boolean;
}

interface RuntimeStatus {
  overallState: OverallBackendState;
  backends: BackendRuntimeStatus[];
  updatedAt: number;
}

interface UseRuntimeEventsReturn {
  overallState: OverallBackendState;
  backendStatuses: Record<string, BackendRuntimeStatus>;
  connect: () => Promise<void>;
}

const PRODUCT_EVENT_TYPES = [
  'runtime.backend_status_changed',
] as const;

/**
 * Product runtime transport.
 *
 * It does not open a WebSocket or implement the OpenClaw protocol; all browser
 * traffic is HTTP/SSE to ConvoSketchpad.
 */
export function useRuntimeEvents(): UseRuntimeEventsReturn {
  const [overallState, setOverallState] = useState<OverallBackendState>('connecting');
  const [backendStatuses, setBackendStatuses] = useState<Record<string, BackendRuntimeStatus>>({});
  const sourceRef = useRef<EventSource | null>(null);

  const applyStatus = useCallback((status: RuntimeStatus) => {
    setOverallState(status.overallState);
    setBackendStatuses(Object.fromEntries(status.backends.map((backend) => [backend.backendId, backend])));
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
          if (type === 'runtime.backend_status_changed') {
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
    backendStatuses,
    connect,
  };
}
