import { useCallback, useEffect, useRef, useState } from 'react';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface RuntimeStatus {
  state: 'disconnected' | 'connecting' | 'connected';
}

interface UseRuntimeEventsReturn {
  connectionState: ConnectionState;
  connect: () => Promise<void>;
}

const PRODUCT_EVENT_TYPES = [
  'runtime.connection_changed',
] as const;

/**
 * Product runtime transport.
 *
 * It does not open a WebSocket or implement the OpenClaw protocol; all browser
 * traffic is HTTP/SSE to ConvoSketchpad.
 */
export function useRuntimeEvents(): UseRuntimeEventsReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const sourceRef = useRef<EventSource | null>(null);

  const applyStatus = useCallback((status: RuntimeStatus) => {
    setConnectionState(status.state);
  }, []);

  const disconnect = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setConnectionState('disconnected');
  }, []);

  const connect = useCallback(async () => {
    sourceRef.current?.close();
    setConnectionState((current) => current === 'connected' ? 'reconnecting' : 'connecting');
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
          if (type === 'runtime.connection_changed') {
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
        setConnectionState('disconnected');
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    connectionState,
    connect,
  };
}
