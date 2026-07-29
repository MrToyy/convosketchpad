import { useEffect, useRef, useState } from 'react';
import type { CanvasSyncBatch } from '@/features/canvas/types';

export type CanvasSyncStreamState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export function useCanvasSync(input: {
  canvasId: string | null;
  cursor: number;
  onSync: (batch: CanvasSyncBatch) => void;
  onPreview: (interactionId: string, text: string) => void;
  onDisconnect: () => void;
}): CanvasSyncStreamState {
  const [state, setState] = useState<CanvasSyncStreamState>('disconnected');
  const callbacks = useRef(input);
  callbacks.current = input;

  useEffect(() => {
    if (!input.canvasId) {
      setState('disconnected');
      return;
    }
    const canvasId = input.canvasId;
    const source = new EventSource(
      `/api/canvas/canvases/${encodeURIComponent(canvasId)}/events?after=${Math.max(0, input.cursor)}`,
      { withCredentials: true },
    );
    setState('connecting');
    source.onopen = () => setState('connected');
    source.onerror = () => {
      setState('reconnecting');
      callbacks.current.onDisconnect();
    };
    source.addEventListener('canvas.sync', (event) => {
      try {
        callbacks.current.onSync(JSON.parse((event as MessageEvent<string>).data) as CanvasSyncBatch);
      } catch {
        // A malformed batch is ignored; the persisted cursor remains available for reconnect.
      }
    });
    source.addEventListener('node.preview', (event) => {
      try {
        const preview = JSON.parse((event as MessageEvent<string>).data) as {
          interactionId?: string;
          text?: string;
        };
        if (preview.interactionId && typeof preview.text === 'string') {
          callbacks.current.onPreview(preview.interactionId, preview.text);
        }
      } catch {
        // Preview is intentionally best-effort and non-replayable.
      }
    });
    return () => {
      source.close();
      callbacks.current.onDisconnect();
      setState('disconnected');
    };
    // A Canvas stream starts from the snapshot cursor. Later cursor changes are
    // acknowledged by SSE Last-Event-ID and do not require a new connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.canvasId]);

  return state;
}
