import '@xyflow/react/dist/style.css';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type NodeChange,
  type NodeDimensionChange,
  type ReactFlowInstance,
  type Viewport,
  type XYPosition,
} from '@xyflow/react';
import {
  AlertCircle,
  Bot,
  Loader2,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRuntime } from '@/contexts/RuntimeContext';
import { useSettings } from '@/contexts/SettingsContext';
import { canvasApi, persistCanvasFiles } from './api';
import { CanvasLocalizedError, canvasErrorMessage, getCanvasCopy, type CanvasCopy } from './messages';
import {
  autoLayoutCanvasNodes,
  canvasNodeBounds,
  canvasNodeTypes,
  type CanvasFlowNode,
} from './CanvasNodes';
import { EMPTY_CANVAS_DRAFT } from './constants';
import {
  contextForComposerSource,
  deriveCanvasStatusCounts,
  type CanvasStatusStats,
} from './status';
import {
  DEFAULT_NODE_HEIGHT,
  INTERACTION_NODE_WIDTH,
  canvasLayoutNodes,
  canvasLayoutPositions,
  canvasLayoutSizes,
  composerNodeId,
  mergeVisibleNodePositions,
  mergeVisibleNodeSizes,
  placeNodeToRight,
  placeRootNode,
  type CanvasNodeSize,
} from './layout';
import { projectCanvasFlow } from './canvas-flow-projection';
import { useCanvasComposerDrafts } from './useCanvasComposerDrafts';
import { useCanvasGraphController } from './useCanvasGraphController';
import type {
  CanvasBranch,
  CanvasGraph,
  CanvasInteraction,
  CanvasSummary,
  CanvasSyncBatch,
} from './types';

function nextCanvasName(canvases: CanvasSummary[], copy: CanvasCopy): string {
  const names = new Set(canvases.map((canvas) => canvas.name));
  let index = 1;
  while (names.has(copy.defaultCanvasName(index))) index += 1;
  return copy.defaultCanvasName(index);
}

interface GatewayAgentOption {
  id: string;
  name?: string;
  identity?: { name?: string; emoji?: string };
}

function branchHasComposer(graph: CanvasGraph, branchId: string): boolean {
  const branch = graph.branches.find((candidate) => candidate.id === branchId);
  if (!branch) return false;
  if (branch.sessionState === 'draft') return true;
  const head = branch.headInteractionId
    ? graph.interactions.find((interaction) => interaction.id === branch.headInteractionId)
    : undefined;
  return branch.sessionState === 'active' && head?.executionState === 'completed';
}

export function CanvasPanel({ onStatusStatsChange }: { onStatusStatsChange?: (stats: CanvasStatusStats) => void }) {
  const { connectionState } = useRuntime();
  const { language } = useSettings();
  const copy = getCanvasCopy(language);
  const localizeError = useCallback((cause: unknown, fallback: string) => canvasErrorMessage(cause, fallback, language), [language]);
  const [canvases, setCanvases] = useState<CanvasSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<CanvasFlowNode[]>([]);
  const {
    drafts,
    trackedOperations,
    updateDraft,
    addFiles,
    removeFile,
    removePersistedAttachment,
    clearDraft,
    markSending,
    trackOperation,
    markFailed,
    reconcileOperations,
    hydrateFailedSends,
  } = useCanvasComposerDrafts();
  const [error, setError] = useState<string | null>(null);
  const [canvasListVisible, setCanvasListVisible] = useState(true);
  const [editingCanvasId, setEditingCanvasId] = useState<string | null>(null);
  const [editingCanvasName, setEditingCanvasName] = useState('');
  const [agents, setAgents] = useState<GatewayAgentOption[]>([]);
  const [agentCatalogError, setAgentCatalogError] = useState(false);
  const [agentCatalogLoading, setAgentCatalogLoading] = useState(false);
  const [agentChanging, setAgentChanging] = useState(false);
  const [rearranging, setRearranging] = useState(false);
  const [resubmittingInteractionIds, setResubmittingInteractionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [focusedComposer, setFocusedComposer] = useState<{
    branchId: string;
    sourceInteractionId: string | null;
  } | null>(null);
  const saveTimer = useRef<number | null>(null);
  const nodesRef = useRef<CanvasFlowNode[]>([]);
  const positionsRef = useRef<Record<string, XYPosition>>({});
  const sizesRef = useRef<Record<string, CanvasNodeSize>>({});
  const viewportRef = useRef<Viewport | undefined>(undefined);
  const reactFlowRef = useRef<ReactFlowInstance<CanvasFlowNode, Edge> | null>(null);
  const arrangeInProgressRef = useRef(false);
  const knownLayoutNodeIdsRef = useRef(new Set<string>());
  const selectedIdRef = useRef<string | null>(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  const sendOperationError = useCallback((operation: {
    error: string | null;
  }) => localizeError(
    new Error(operation.error || 'send_rejected'),
    copy.messageSendFailed,
  ), [copy.messageSendFailed, localizeError]);
  const handleGraphSnapshot = useCallback((nextGraph: CanvasGraph, canvasChanged: boolean) => {
    if (canvasChanged) {
      setFocusedComposer(null);
      positionsRef.current = canvasLayoutPositions(nextGraph.layout?.nodes || {});
      sizesRef.current = canvasLayoutSizes(nextGraph.layout?.nodes || {});
      viewportRef.current = nextGraph.layout?.viewport;
      nodesRef.current = [];
      knownLayoutNodeIdsRef.current = new Set(Object.keys(nextGraph.layout?.nodes || {}));
      setNodes([]);
    } else {
      positionsRef.current = {
        ...canvasLayoutPositions(nextGraph.layout?.nodes || {}),
        ...positionsRef.current,
      };
      sizesRef.current = {
        ...canvasLayoutSizes(nextGraph.layout?.nodes || {}),
        ...sizesRef.current,
      };
    }
  }, []);
  const handleCanvasSync = useCallback((batch: CanvasSyncBatch) => {
    reconcileOperations(batch.sendOperations, sendOperationError);
  }, [reconcileOperations, sendOperationError]);
  const handleGraphLoadError = useCallback((cause: unknown) => {
    setError(localizeError(cause, copy.loadCanvasFailed));
  }, [copy.loadCanvasFailed, localizeError]);
  const handleGraphRefreshError = useCallback((cause: unknown) => {
    setError(localizeError(cause, copy.refreshOpenClawFailed));
  }, [copy.refreshOpenClawFailed, localizeError]);
  const {
    graph,
    setGraph,
    previews,
    streamState: canvasStreamState,
    loadGraph,
  } = useCanvasGraphController({
    selectedId,
    onSnapshot: handleGraphSnapshot,
    onSyncBatch: handleCanvasSync,
    onLoadError: handleGraphLoadError,
    onRefreshError: handleGraphRefreshError,
  });

  const loadCanvases = useCallback(async () => {
    const list = await canvasApi.list();
    setCanvases(list);
    setSelectedId((current) => current && list.some((item) => item.id === current) ? current : list[0]?.id || null);
  }, []);

  useEffect(() => { void loadCanvases().catch((cause) => setError(localizeError(cause, copy.loadCanvasListFailed))); }, [copy.loadCanvasListFailed, loadCanvases, localizeError]);
  const loadAgents = useCallback(async () => {
    if (connectionState !== 'connected') return;
    setAgentCatalogLoading(true);
    setAgentCatalogError(false);
    try {
      const result = await canvasApi.agents();
      setAgents(Array.isArray(result.agents) ? result.agents.filter((agent) => typeof agent.id === 'string' && agent.id) : []);
    } catch {
      setAgentCatalogError(true);
    } finally {
      setAgentCatalogLoading(false);
    }
  }, [connectionState]);
  useEffect(() => { void loadAgents(); }, [loadAgents]);

  const focusComposer = useCallback((branchId: string, sourceInteractionId: string | null) => {
    setFocusedComposer({ branchId, sourceInteractionId });
  }, []);
  const blurComposer = useCallback((branchId: string) => {
    setFocusedComposer((current) => current?.branchId === branchId ? null : current);
  }, []);

  useEffect(() => {
    const visibleGraph = graph?.canvas.id === selectedId ? graph : null;
    const counts = deriveCanvasStatusCounts(visibleGraph);
    const activeContext = visibleGraph
      && focusedComposer
      && branchHasComposer(visibleGraph, focusedComposer.branchId)
      ? contextForComposerSource(visibleGraph, focusedComposer.sourceInteractionId)
      : undefined;
    onStatusStatsChange?.({ ...counts, ...(activeContext ? { activeContext } : {}) });
  }, [
    focusedComposer,
    graph,
    onStatusStatsChange,
    selectedId,
  ]);
  useEffect(() => {
    if (!graph || Object.keys(trackedOperations).length === 0) return;
    const pendingIds = new Set(graph.pendingSends.map((operation) => operation.id));
    for (const operationId of Object.values(trackedOperations)) {
      if (pendingIds.has(operationId)) continue;
      void canvasApi.sendOperation(operationId)
        .then((operation) => reconcileOperations([operation], sendOperationError))
        .catch(() => undefined);
    }
  }, [graph, reconcileOperations, sendOperationError, trackedOperations]);
  useEffect(() => {
    if (!graph) return;
    hydrateFailedSends(graph.failedSends, sendOperationError);
  }, [graph, hydrateFailedSends, sendOperationError]);
  const persistLayout = useCallback((canvasId = selectedId) => {
    if (!canvasId) return Promise.resolve();
    const layout = {
      nodes: canvasLayoutNodes(positionsRef.current, sizesRef.current),
      ...(viewportRef.current ? { viewport: viewportRef.current } : {}),
    };
    return canvasApi.saveLayout(canvasId, layout);
  }, [selectedId]);

  const send = useCallback(async (branch: CanvasBranch) => {
    const draft = drafts[branch.id] || EMPTY_CANVAS_DRAFT;
    if (
      draft.sending
      || (
        !draft.text.trim()
        && draft.files.length === 0
        && draft.persistedAttachments.length === 0
      )
    ) return;
    const composerSource = branch.sessionState === 'draft'
      ? branch.forkedFromInteractionId
      : branch.headInteractionId;
    const composerId = composerNodeId(branch.id, composerSource);
    const composerPosition = positionsRef.current[composerId]
      || nodesRef.current.find((node) => node.id === composerId)?.position;
    const composerSize = sizesRef.current[composerId];
    markSending(branch.id);
    try {
      const canvasAgentId = graph?.canvas.agentId;
      const canvasId = graph?.canvas.id;
      if (!canvasId || !canvasAgentId) throw new CanvasLocalizedError(copy.currentCanvasMissing);
      const attachmentMeta = draft.files.length ? await persistCanvasFiles(draft.files, canvasId) : [];
      const attachmentIds = [
        ...draft.persistedAttachments.map((attachment) => attachment.id),
        ...attachmentMeta.map((attachment) => attachment.id),
      ];
      const result = await canvasApi.send(branch.id, {
        expectedHeadInteractionId: branch.sessionState === 'active' ? branch.headInteractionId : null,
        expectedAgentId: canvasAgentId,
        userInput: draft.text,
        attachmentIds,
      });
      if (result.interaction && (composerPosition || composerSize)) {
        if (composerPosition) {
          positionsRef.current = {
            ...positionsRef.current,
            [result.interaction.id]: composerPosition,
          };
          delete positionsRef.current[composerId];
        }
        if (composerSize) {
          sizesRef.current = {
            ...sizesRef.current,
            [result.interaction.id]: composerSize,
          };
          delete sizesRef.current[composerId];
        }
        await persistLayout();
      }
      if (result.interaction) clearDraft(branch.id);
      else if (result.operation) trackOperation(branch.id, result.operation.id);
      if (!result.interaction || canvasStreamState !== 'connected') await loadGraph();
    } catch (cause) {
      const message = localizeError(cause, copy.messageSendFailed);
      markFailed(branch.id, message);
    }
  }, [
    canvasStreamState,
    clearDraft,
    copy,
    drafts,
    graph?.canvas.agentId,
    graph?.canvas.id,
    loadGraph,
    localizeError,
    markFailed,
    markSending,
    persistLayout,
    trackOperation,
  ]);

  const addFromInteraction = useCallback(async (interaction: CanvasInteraction) => {
    try {
      const branch = await canvasApi.fork(interaction.id);
      updateDraft(branch.id, (current) => current);
      await loadGraph();
    } catch (cause) { setError(localizeError(cause, copy.forkFailed)); }
  }, [copy.forkFailed, loadGraph, localizeError, updateDraft]);

  const resubmitInteraction = useCallback(async (interaction: CanvasInteraction) => {
    if (resubmittingInteractionIds.has(interaction.id)) return;
    const canvasAgentId = graph?.canvas.agentId;
    if (!canvasAgentId) {
      setError(copy.currentCanvasMissing);
      return;
    }
    setResubmittingInteractionIds((current) => new Set(current).add(interaction.id));
    try {
      const result = await canvasApi.resubmit(interaction.id, canvasAgentId);
      if (result.interaction) {
        const occupied = nodesRef.current.map((node) => canvasNodeBounds(node, node));
        const parentNode = result.interaction.parentInteractionId
          ? nodesRef.current.find((node) => node.id === result.interaction?.parentInteractionId)
          : undefined;
        const position = parentNode
          ? placeNodeToRight(canvasNodeBounds(parentNode, parentNode), occupied, {
            width: INTERACTION_NODE_WIDTH,
            height: DEFAULT_NODE_HEIGHT,
          })
          : placeRootNode(occupied, {
            width: INTERACTION_NODE_WIDTH,
            height: DEFAULT_NODE_HEIGHT,
          });
        positionsRef.current = {
          ...positionsRef.current,
          [result.interaction.id]: position,
        };
        await persistLayout();
      }
      await loadGraph();
    } catch (cause) {
      setError(localizeError(cause, copy.resubmitFailed));
      await loadGraph().catch(() => undefined);
    } finally {
      setResubmittingInteractionIds((current) => {
        const next = new Set(current);
        next.delete(interaction.id);
        return next;
      });
    }
  }, [
    copy.currentCanvasMissing,
    copy.resubmitFailed,
    graph?.canvas.agentId,
    loadGraph,
    localizeError,
    persistLayout,
    resubmittingInteractionIds,
  ]);

  const flow = useMemo(() => {
    if (!graph) return { nodes: [] as CanvasFlowNode[], edges: [] as Edge[] };
    return projectCanvasFlow({
      graph,
      renderedNodes: nodesRef.current,
      positions: positionsRef.current,
      sizes: sizesRef.current,
      resizeEnabled: !rearranging,
      drafts,
      resubmittingInteractionIds,
      previews,
      labels: copy,
      onAdd: addFromInteraction,
      onResubmit: (interaction) => void resubmitInteraction(interaction),
      onTextChange: (branchId, value) => {
        updateDraft(branchId, (draft) => ({ ...draft, text: value, error: null }));
      },
      onFiles: addFiles,
      onRemoveFile: removeFile,
      onRemovePersistedAttachment: removePersistedAttachment,
      onSend: (branch) => void send(branch),
      onFocus: focusComposer,
      onBlur: blurComposer,
    });
  }, [
    addFiles,
    addFromInteraction,
    blurComposer,
    copy,
    drafts,
    focusComposer,
    graph,
    previews,
    rearranging,
    removeFile,
    removePersistedAttachment,
    resubmitInteraction,
    resubmittingInteractionIds,
    send,
    updateDraft,
  ]);

  useEffect(() => {
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]));
      const next = flow.nodes.map((node) => {
        const existing = currentById.get(node.id);
        return existing
          ? {
            ...existing,
            ...node,
            position: existing.position,
            width: existing.width ?? node.width,
            height: existing.height ?? node.height,
            measured: existing.measured,
          }
          : node;
      });
      nodesRef.current = next;
      positionsRef.current = mergeVisibleNodePositions(
        positionsRef.current,
        Object.fromEntries(next.map((node) => [node.id, node.position])),
      );
      sizesRef.current = mergeVisibleNodeSizes({
        ...sizesRef.current,
        ...Object.fromEntries(next.flatMap((node) =>
          node.width !== undefined && node.height !== undefined
            ? [[node.id, { width: node.width, height: node.height }]]
            : [])),
      }, next.map((node) => node.id));
      return next;
    });
  }, [flow.nodes]);

  useEffect(() => {
    if (!selectedId || nodes.length === 0) return;
    const currentIds = new Set(nodes.map((node) => node.id));
    const hasNewAutoPlacedNode = nodes.some((node) => !knownLayoutNodeIdsRef.current.has(node.id));
    knownLayoutNodeIdsRef.current = currentIds;
    if (!hasNewAutoPlacedNode) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persistLayout().catch((cause) => setError(localizeError(cause, copy.saveLayoutFailed)));
    }, 100);
  }, [copy.saveLayoutFailed, localizeError, nodes, persistLayout, selectedId]);

  const onNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      nodesRef.current = next;
      positionsRef.current = mergeVisibleNodePositions(
        positionsRef.current,
        Object.fromEntries(next.map((node) => [node.id, node.position])),
      );
      const manualDimensions = changes.filter((change): change is NodeDimensionChange =>
        change.type === 'dimensions'
        && change.resizing !== undefined
        && change.dimensions !== undefined);
      if (manualDimensions.length > 0) {
        sizesRef.current = {
          ...sizesRef.current,
          ...Object.fromEntries(manualDimensions.map((change) => [
            change.id,
            {
              width: change.dimensions!.width,
              height: change.dimensions!.height,
            },
          ])),
        };
      }
      return next;
    });
    const changedLayout = changes.some((change) =>
      change.type === 'position'
      || (change.type === 'dimensions' && change.resizing !== undefined));
    if (!selectedId || !changedLayout) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persistLayout().catch((cause) => setError(localizeError(cause, copy.saveLayoutFailed)));
    }, 500);
  }, [copy.saveLayoutFailed, localizeError, persistLayout, selectedId]);

  const onMoveEnd = useCallback((_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    if (!selectedId) return;
    viewportRef.current = viewport;
    if (arrangeInProgressRef.current) return;
    void persistLayout().catch((cause) => setError(localizeError(cause, copy.saveLayoutFailed)));
  }, [copy.saveLayoutFailed, localizeError, persistLayout, selectedId]);

  const workingCount = deriveCanvasStatusCounts(
    graph?.canvas.id === selectedId ? graph : null,
  ).workingCount;
  const hasLocalSend = graph?.canvas.id === selectedId
    && graph.branches.some((branch) => drafts[branch.id]?.sending);
  const rearrangeDisabled = rearranging || workingCount > 0 || hasLocalSend || nodes.length === 0;

  const rearrangeCanvas = useCallback(async () => {
    const canvasId = selectedId;
    const instance = reactFlowRef.current;
    const currentNodes = nodesRef.current;
    if (!canvasId || !instance || currentNodes.length === 0 || rearranging || workingCount > 0 || hasLocalSend) return;

    const previousNodes = currentNodes;
    const previousPositions = { ...positionsRef.current };
    const previousViewport = instance.getViewport();
    const arrangedNodes = autoLayoutCanvasNodes(currentNodes, flow.edges);
    const arrangedPositions = Object.fromEntries(
      arrangedNodes.map((node) => [node.id, node.position]),
    );

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    arrangeInProgressRef.current = true;
    setRearranging(true);
    nodesRef.current = arrangedNodes;
    positionsRef.current = arrangedPositions;
    knownLayoutNodeIdsRef.current = new Set(arrangedNodes.map((node) => node.id));
    setNodes(arrangedNodes);

    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await instance.fitView({
        padding: 0.12,
        duration: 300,
        minZoom: 0.2,
        maxZoom: 1.5,
      });
      const viewport = instance.getViewport();
      if (selectedIdRef.current === canvasId) viewportRef.current = viewport;
      await canvasApi.saveLayout(canvasId, {
        nodes: canvasLayoutNodes(arrangedPositions, sizesRef.current),
        viewport,
      });
    } catch (cause) {
      if (selectedIdRef.current === canvasId) {
        nodesRef.current = previousNodes;
        positionsRef.current = previousPositions;
        viewportRef.current = previousViewport;
        knownLayoutNodeIdsRef.current = new Set(previousNodes.map((node) => node.id));
        setNodes(previousNodes);
        await instance.setViewport(previousViewport, { duration: 150 }).catch(() => undefined);
      }
      setError(localizeError(cause, copy.saveLayoutFailed));
    } finally {
      arrangeInProgressRef.current = false;
      setRearranging(false);
    }
  }, [
    copy.saveLayoutFailed,
    flow.edges,
    hasLocalSend,
    localizeError,
    rearranging,
    selectedId,
    workingCount,
  ]);

  const createCanvas = useCallback(async () => {
    const name = nextCanvasName(canvases, copy);
    try {
      const canvas = await canvasApi.create(name);
      await canvasApi.createRoot(canvas.id);
      await loadCanvases();
      setSelectedId(canvas.id);
      setEditingCanvasId(canvas.id);
      setEditingCanvasName(canvas.name);
    } catch (cause) { setError(localizeError(cause, copy.createCanvasFailed)); }
  }, [canvases, copy, loadCanvases, localizeError]);

  const agentEditable = graph !== null
    && graph.interactions.length === 0
    && !Object.values(drafts).some((draft) => draft.sending);

  const changeAgent = useCallback(async (agentId: string) => {
    if (!graph || !agentEditable || agentId === graph.canvas.agentId) return;
    setAgentChanging(true);
    try {
      const updated = await canvasApi.updateAgent(graph.canvas.id, agentId);
      setCanvases((current) => current.map((item) => item.id === updated.id ? updated : item));
      await loadGraph();
    } catch (cause) {
      setError(localizeError(cause, copy.changeAgentFailed));
      await loadGraph().catch(() => undefined);
    } finally {
      setAgentChanging(false);
    }
  }, [agentEditable, copy.changeAgentFailed, graph, loadGraph, localizeError]);

  const renameCanvas = useCallback(async (canvas: CanvasSummary) => {
    const name = editingCanvasName.trim();
    setEditingCanvasId(null);
    if (!name || name === canvas.name) return;
    try {
      const updated = await canvasApi.update(canvas.id, name);
      setCanvases((current) => current.map((item) => item.id === updated.id ? updated : item));
      setGraph((current) => current?.canvas.id === updated.id ? { ...current, canvas: updated } : current);
    } catch (cause) {
      setError(localizeError(cause, copy.renameCanvasFailed));
    }
  }, [copy.renameCanvasFailed, editingCanvasName, localizeError, setGraph]);

  const createRoot = useCallback(async () => {
    if (!selectedId) return;
    try { await canvasApi.createRoot(selectedId); await loadGraph(); }
    catch (cause) { setError(localizeError(cause, copy.createSessionFailed)); }
  }, [copy.createSessionFailed, loadGraph, localizeError, selectedId]);

  const deleteCanvas = useCallback(async (canvas: CanvasSummary) => {
    if (!window.confirm(copy.deleteCanvasConfirm(canvas.name))) return;
    await canvasApi.remove(canvas.id);
    await loadCanvases();
  }, [copy, loadCanvases]);

  return (
    <div lang={language} className="flex h-full min-h-0 w-full overflow-hidden bg-background">
      {canvasListVisible && (
        <aside className="flex w-64 shrink-0 flex-col border-r border-border/75 bg-card/65 p-3">
          <div className="flex items-center justify-between gap-2 px-1 py-2">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{copy.canvasList}</div>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" onClick={() => setCanvasListVisible(false)} title={copy.hideCanvasList} aria-label={copy.hideCanvasList}><PanelLeftClose size={15} /></Button>
              <Button size="icon" variant="outline" onClick={() => void createCanvas()} title={copy.newCanvas}><Plus size={15} /></Button>
            </div>
          </div>
          <div className="mt-2 grid gap-2 overflow-y-auto">
            {canvases.map((canvas) => (
              <div key={canvas.id} className={`group flex items-center gap-1 rounded-2xl border p-1 ${selectedId === canvas.id ? 'border-primary/40 bg-primary/8' : 'border-transparent hover:bg-secondary/70'}`}>
                {editingCanvasId === canvas.id ? (
                  <div className="min-w-0 flex-1 px-2 py-1.5">
                    <input
                      autoFocus
                      value={editingCanvasName}
                      onChange={(event) => setEditingCanvasName(event.target.value)}
                      onBlur={() => void renameCanvas(canvas)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') setEditingCanvasId(null);
                      }}
                      maxLength={120}
                      aria-label={copy.renameCanvas(canvas.name)}
                      className="w-full rounded-lg border border-primary/45 bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="mt-1 px-1 text-[0.667rem] text-muted-foreground">{copy.renameHint}</div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setSelectedId(canvas.id)} onDoubleClick={() => { setEditingCanvasId(canvas.id); setEditingCanvasName(canvas.name); }} className="min-w-0 flex-1 rounded-xl px-3 py-2 text-left">
                    <div className="truncate text-sm font-medium">{canvas.name}</div>
                    <div className="mt-1 text-[0.667rem] text-muted-foreground">{new Date(canvas.updatedAt).toLocaleDateString(language)}</div>
                  </button>
                )}
                {editingCanvasId !== canvas.id && (
                  <button type="button" onClick={() => { setEditingCanvasId(canvas.id); setEditingCanvasName(canvas.name); }} className="p-2 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100" aria-label={copy.renameCanvas(canvas.name)} title={copy.renameCanvas(canvas.name)}><Pencil size={14} /></button>
                )}
                <button type="button" onClick={() => void deleteCanvas(canvas)} className="p-2 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100" aria-label={copy.deleteCanvas(canvas.name)} title={copy.deleteCanvas(canvas.name)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </aside>
      )}

      <main className="relative min-w-0 flex-1">
        {!canvasListVisible && <Button size="icon" variant="outline" onClick={() => setCanvasListVisible(true)} className="absolute left-4 top-4 z-20 bg-card/92 shadow-lg backdrop-blur" title={copy.showCanvasList} aria-label={copy.showCanvasList}><PanelLeftOpen size={15} /></Button>}
        {error && <button translate="no" type="button" onClick={() => setError(null)} className="notranslate absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-destructive/30 bg-card px-3 py-2 text-xs text-destructive"><AlertCircle size={14} />{error}<X size={13} /></button>}
        {selectedId && graph ? (
          <>
            <div className={`absolute top-4 z-10 flex items-center gap-3 rounded-2xl border border-border/75 bg-card/92 px-3 py-2 shadow-lg backdrop-blur ${canvasListVisible ? 'left-4' : 'left-16'}`}>
              <Bot size={16} className={connectionState === 'connected' ? 'text-green' : 'text-muted-foreground'} />
              <div className="text-sm font-semibold">{graph.canvas.name}</div>
              {graph.interactions.length === 0 ? (
                <div className="flex items-center gap-1">
                  <select
                    value={graph.canvas.agentId}
                    onChange={(event) => void changeAgent(event.target.value)}
                    disabled={!agentEditable || agentChanging || agentCatalogLoading || connectionState !== 'connected'}
                    aria-label={copy.selectAgent}
                    className="max-w-48 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                  >
                    {!agents.some((agent) => agent.id === graph.canvas.agentId) && <option value={graph.canvas.agentId}>{graph.canvas.agentId}</option>}
                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{`${agent.identity?.emoji || ''} ${agent.identity?.name || agent.name || agent.id}`.trim()} · {agent.id}</option>)}
                  </select>
                  {agentCatalogError && <Button size="icon" variant="ghost" onClick={() => void loadAgents()} title={copy.retryAgentList}><RefreshCw size={13} /></Button>}
                </div>
              ) : <span className="rounded-lg bg-secondary px-2 py-1 text-xs text-muted-foreground">{copy.agentLabel(graph.canvas.agentId)}</span>}
              <Button size="sm" onClick={() => void createRoot()}><Plus size={14} /> {copy.newSession}</Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void rearrangeCanvas()}
                disabled={rearrangeDisabled}
                title={workingCount > 0 || hasLocalSend ? copy.rearrangeUnavailableWhileWorking : copy.rearrangeCanvas}
              >
                {rearranging
                  ? <Loader2 size={14} aria-hidden="true" className="animate-spin" />
                  : <Network size={14} aria-hidden="true" />}
                {rearranging ? copy.rearrangingCanvas : copy.rearrangeCanvas}
              </Button>
            </div>
            <ReactFlow
              key={selectedId}
              nodes={nodes}
              edges={flow.edges}
              nodeTypes={canvasNodeTypes}
              onNodesChange={onNodesChange}
              onMoveEnd={onMoveEnd}
              onInit={(instance) => { reactFlowRef.current = instance; }}
              nodesDraggable={!rearranging}
              fitView
              minZoom={0.2}
              maxZoom={1.5}
              defaultViewport={graph.layout?.viewport}
              colorMode="dark"
              proOptions={{ hideAttribution: true }}
              ariaLabelConfig={{
                'controls.ariaLabel': copy.canvasControls,
                'controls.zoomIn.ariaLabel': copy.zoomIn,
                'controls.zoomOut.ariaLabel': copy.zoomOut,
                'controls.fitView.ariaLabel': copy.fitView,
                'controls.interactive.ariaLabel': copy.toggleInteractive,
                'minimap.ariaLabel': copy.minimap,
              }}
            >
              <Background gap={24} size={1} />
              <Controls />
              <MiniMap pannable zoomable className="!bg-card" />
            </ReactFlow>
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div><Sparkles size={34} className="mx-auto text-primary" /><h2 className="mt-4 text-2xl font-semibold">{copy.emptyTitle}</h2><p className="mt-2 text-sm text-muted-foreground">{copy.emptyDescription}</p><Button className="mt-5" onClick={() => void createCanvas()}><Plus size={15} /> {copy.newCanvas}</Button></div>
          </div>
        )}
      </main>
    </div>
  );
}
