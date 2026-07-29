import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useCanvasSync } from '@/hooks/useCanvasSync';
import { canvasApi } from './api';
import {
  createGraphRefreshController,
  graphNeedsFallbackPolling,
} from './graph-refresh';
import { applyCanvasSyncBatch } from './sync';
import type { CanvasGraph, CanvasSyncBatch } from './types';

interface CanvasGraphControllerOptions {
  selectedId: string | null;
  onSnapshot(graph: CanvasGraph, canvasChanged: boolean): void;
  onSyncBatch(batch: CanvasSyncBatch): void;
  onLoadError(error: unknown): void;
  onRefreshError(error: unknown): void;
}

interface CanvasGraphController {
  graph: CanvasGraph | null;
  setGraph: Dispatch<SetStateAction<CanvasGraph | null>>;
  previews: Record<string, string>;
  streamState: ReturnType<typeof useCanvasSync>;
  loadGraph(): Promise<void>;
  scheduleGraphRefresh(delayMs?: number): void;
}

export function useCanvasGraphController(
  options: CanvasGraphControllerOptions,
): CanvasGraphController {
  const {
    selectedId,
    onSnapshot,
    onSyncBatch,
    onLoadError,
    onRefreshError,
  } = options;
  const [graph, setGraph] = useState<CanvasGraph | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const loadedCanvasRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  const graphRefreshRef = useRef<ReturnType<typeof createGraphRefreshController> | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadGraphOnce = useCallback(async () => {
    const canvasId = selectedId;
    if (!canvasId) {
      setGraph(null);
      return;
    }
    let nextGraph = await canvasApi.graph(canvasId);
    if (nextGraph.branches.length === 0 && nextGraph.interactions.length === 0) {
      await canvasApi.createRoot(canvasId);
      nextGraph = await canvasApi.graph(canvasId);
    }
    if (selectedIdRef.current !== canvasId) return;
    const canvasChanged = loadedCanvasRef.current !== canvasId;
    if (canvasChanged) {
      loadedCanvasRef.current = canvasId;
      setPreviews({});
    }
    onSnapshot(nextGraph, canvasChanged);
    setGraph(nextGraph);
  }, [onSnapshot, selectedId]);

  useEffect(() => {
    const controller = createGraphRefreshController(loadGraphOnce, onRefreshError);
    graphRefreshRef.current = controller;
    void controller.run().catch(onLoadError);
    return () => {
      controller.dispose();
      if (graphRefreshRef.current === controller) graphRefreshRef.current = null;
    };
  }, [loadGraphOnce, onLoadError, onRefreshError]);
  const loadGraph = useCallback(
    () => graphRefreshRef.current?.run() || loadGraphOnce(),
    [loadGraphOnce],
  );
  const scheduleGraphRefresh = useCallback((delayMs?: number) => {
    graphRefreshRef.current?.schedule(delayMs);
  }, []);

  const handleCanvasSync = useCallback((batch: CanvasSyncBatch) => {
    onSyncBatch(batch);
    setGraph((current) => current && current.canvas.id === selectedIdRef.current
      ? applyCanvasSyncBatch(current, batch)
      : current);
    if (batch.interactions.length > 0) {
      setPreviews((current) => {
        const next = { ...current };
        for (const interaction of batch.interactions) {
          if (interaction.executionState !== 'running' || interaction.agentOutput) {
            delete next[interaction.id];
          }
        }
        return next;
      });
    }
  }, [onSyncBatch]);
  const handleCanvasPreview = useCallback((interactionId: string, text: string) => {
    setPreviews((current) => ({ ...current, [interactionId]: text }));
  }, []);
  const clearCanvasPreviews = useCallback(() => setPreviews({}), []);
  const syncCanvasId = graph?.canvas.id === selectedId ? selectedId : null;
  const streamState = useCanvasSync({
    canvasId: syncCanvasId,
    cursor: graph?.cursor || 0,
    onSync: handleCanvasSync,
    onPreview: handleCanvasPreview,
    onDisconnect: clearCanvasPreviews,
  });

  useEffect(() => {
    if (!graphNeedsFallbackPolling(streamState, Boolean(graph?.hasPendingUpdates))) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') scheduleGraphRefresh(0);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [graph?.hasPendingUpdates, scheduleGraphRefresh, streamState]);

  return {
    graph,
    setGraph,
    previews,
    streamState,
    loadGraph,
    scheduleGraphRefresh,
  };
}
