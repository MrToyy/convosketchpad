import '@xyflow/react/dist/style.css';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type Viewport,
  type XYPosition,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import {
  AlertCircle,
  Bot,
  Download,
  File,
  FileCode2,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
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
import { MarkdownRenderer } from '@/features/markdown/MarkdownRenderer';
import { useGateway } from '@/contexts/GatewayContext';
import { useSettings } from '@/contexts/SettingsContext';
import { getAppCopy } from '@/lib/app-messages';
import { classifyStreamEvent, extractStreamDelta } from '@/features/chat/operations';
import { sendChatMessage } from '@/features/chat/operations/sendMessage';
import { ImageLightbox } from '@/features/chat/ImageLightbox';
import type { ChatEventPayload, GatewayEvent } from '@/types';
import { canvasApi, canvasArtifactUrl, persistCanvasFiles } from './api';
import {
  estimateChatSendFrameBytes,
  prepareGatewayAttachment,
  prepareGatewayAttachments,
  type GatewayAttachment,
} from './attachments';
import { CanvasLocalizedError, canvasErrorMessage, getCanvasCopy, type CanvasCopy } from './messages';
import { CanvasSendButton } from './CanvasSendButton';
import {
  COMPOSER_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  INTERACTION_NODE_WIDTH,
  NODE_HORIZONTAL_GAP,
  NODE_VERTICAL_GAP,
  composerNodeId,
  mergeVisibleNodePositions,
  placeNodeToRight,
  placeRootNode,
  type CanvasNodeBounds,
} from './layout';
import type {
  AgentActivity,
  CanvasBranch,
  CanvasDraft,
  CanvasGraph,
  CanvasInteraction,
  CanvasSummary,
} from './types';

const MAX_ATTACHMENTS = 4;
const EMPTY_DRAFT: CanvasDraft = { text: '', files: [], previews: {}, sending: false, error: null };

function nextCanvasName(canvases: CanvasSummary[], copy: CanvasCopy): string {
  const names = new Set(canvases.map((canvas) => canvas.name));
  let index = 1;
  while (names.has(copy.defaultCanvasName(index))) index += 1;
  return copy.defaultCanvasName(index);
}

interface InteractionNodeData extends Record<string, unknown> {
  interaction: CanvasInteraction;
  activity: AgentActivity;
  composerOpen: boolean;
  canAdd: boolean;
  onAdd: (interaction: CanvasInteraction) => void;
}

interface GatewayAgentOption {
  id: string;
  name?: string;
  identity?: { name?: string; emoji?: string };
}

interface ComposerNodeData extends Record<string, unknown> {
  branch: CanvasBranch;
  draft: CanvasDraft;
  label: string;
  onTextChange: (value: string) => void;
  onFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  onSend: () => void;
  onClose?: () => void;
}

type InteractionFlowNode = Node<InteractionNodeData, 'interaction'>;
type ComposerFlowNode = Node<ComposerNodeData, 'composer'>;
type CanvasFlowNode = InteractionFlowNode | ComposerFlowNode;

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function artifactIcon(mimeType = '') {
  if (mimeType.startsWith('image/')) return ImageIcon;
  if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('javascript')) return FileCode2;
  if (mimeType.includes('pdf') || mimeType.includes('document')) return FileText;
  return File;
}

function interactionStatusLabel(interaction: CanvasInteraction, activity: AgentActivity, copy: CanvasCopy): string {
  if (activity === 'queued') return copy.status.queued;
  if (activity === 'working') return copy.status.working;
  if (activity === 'settling') return copy.status.settling;
  if (interaction.status === 'streaming') return copy.status.streaming;
  if (interaction.status === 'completed') return copy.status.completed;
  return copy.status.failed;
}

function reconciliationMetadata(interaction: CanvasInteraction): { phase?: string; artifactSync?: string; version?: number } {
  const value = interaction.sessionMetadata.reconciliation;
  return value && typeof value === 'object' ? value as { phase?: string; artifactSync?: string; version?: number } : {};
}

function needsReconciliation(interaction: CanvasInteraction, currentVersion: number): boolean {
  const reconciliation = reconciliationMetadata(interaction);
  return interaction.status === 'streaming' || reconciliation.artifactSync === 'pending' || reconciliation.version !== currentVersion;
}

function reconciledActivity(interaction: CanvasInteraction): AgentActivity {
  const phase = reconciliationMetadata(interaction).phase;
  if (phase === 'settling') return 'settling';
  if (phase === 'monitoring') return 'working';
  return interaction.status === 'streaming' ? 'unknown' : 'idle';
}

function InteractionNode({ data }: NodeProps<InteractionFlowNode>) {
  const { language } = useSettings();
  const copy = getCanvasCopy(language);
  const { interaction, activity, composerOpen, canAdd, onAdd } = data;
  const bootstrapWarnings = Array.isArray(interaction.sessionMetadata.bootstrapWarnings)
    ? interaction.sessionMetadata.bootstrapWarnings.filter((item): item is string => typeof item === 'string')
    : [];
  return (
    <article className="w-[380px] rounded-3xl border border-border/80 bg-card/96 p-4 shadow-2xl backdrop-blur">
      <Handle type="target" position={Position.Left} className="!bg-primary" />
      <header className="canvas-node-drag-handle flex cursor-grab items-center justify-between gap-3 active:cursor-grabbing">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-2 rounded-full ${activity === 'working' || activity === 'queued' || activity === 'settling' ? 'animate-pulse bg-primary' : interaction.status === 'failed' ? 'bg-destructive' : 'bg-green'}`} />
          <span translate="no" className="notranslate truncate text-[0.667rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {interactionStatusLabel(interaction, activity, copy)}
          </span>
        </div>
        <time className="text-[0.667rem] text-muted-foreground">{new Date(interaction.createdAt).toLocaleTimeString(language)}</time>
      </header>

      <details className="nodrag mt-3 cursor-text select-text rounded-2xl border border-border/60 bg-background/45 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{copy.userInput}</summary>
        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{interaction.userInput || copy.attachmentsOnly}</p>
        {interaction.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {interaction.attachments.map((item, index) => (
              <span key={`${item.name}-${index}`} className="rounded-lg bg-secondary px-2 py-1 text-[0.667rem] text-muted-foreground">
                {item.name}
              </span>
            ))}
          </div>
        )}
      </details>

      <div className="nodrag nowheel mt-3 max-h-[360px] cursor-text select-text overflow-auto text-sm">
        {interaction.status === 'streaming' && !interaction.agentOutput ? (
          <div translate="no" className="notranslate flex items-center gap-2 py-4 text-muted-foreground"><Loader2 size={15} className="animate-spin" /> {activity === 'settling' ? copy.waitingForCompleteReply : copy.waitingForResponse}</div>
        ) : interaction.agentOutput ? (
          <MarkdownRenderer content={interaction.agentOutput} />
        ) : (
          <p translate="no" className="notranslate py-3 text-muted-foreground">{copy.noResponse}</p>
        )}
      </div>

      {bootstrapWarnings.length > 0 && (
        <div translate="no" className="notranslate nodrag mt-3 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <div className="flex items-center gap-2 font-medium"><AlertCircle size={14} />{copy.partialHistoryResources}</div>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {bootstrapWarnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
          </ul>
        </div>
      )}

      {interaction.artifacts.length > 0 && (
        <div className="nodrag mt-4 grid cursor-text select-text gap-2">
          {interaction.artifacts.map((artifact, index) => {
            const Icon = artifactIcon(artifact.mimeType);
            const isImage = artifact.mimeType?.startsWith('image/');
            const available = artifact.available !== false;
            return (
              <div key={`${artifact.uri}-${index}`} className="overflow-hidden rounded-2xl border border-border/60 bg-background/45">
                {isImage && available && (
                  <ImageLightbox
                    src={canvasArtifactUrl(artifact.uri)}
                    alt={artifact.name}
                    thumbnailClassName="max-h-56 w-full cursor-zoom-in bg-black/10 object-contain"
                  />
                )}
                {available ? (
                  <a href={canvasArtifactUrl(artifact.uri)} target="_blank" rel="noreferrer" download className="flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-secondary/70">
                    <Icon size={14} /><span className="min-w-0 flex-1 truncate">{artifact.name}</span><Download size={13} />
                  </a>
                ) : (
                  <div className="flex items-start gap-2 px-3 py-2 text-xs text-amber-300">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span className="min-w-0"><span className="block truncate">{artifact.name}</span><span className="text-amber-300/80">{artifact.warning || copy.artifactUnavailable}</span></span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!composerOpen && canAdd && (
        <button
          type="button"
          onClick={() => onAdd(interaction)}
          title={copy.forkFromInteraction}
          className="nodrag absolute -right-4 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-primary/40 bg-background text-primary shadow-lg hover:bg-primary hover:text-primary-foreground"
        >
          <Plus size={15} />
        </button>
      )}
      <Handle type="source" position={Position.Right} className="!bg-primary" />
    </article>
  );
}

function ComposerNode({ data }: NodeProps<ComposerFlowNode>) {
  const { language } = useSettings();
  const copy = getCanvasCopy(language);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <section className="w-[360px] rounded-3xl border border-primary/35 bg-card/98 p-4 shadow-2xl">
      <Handle type="target" position={Position.Left} className="!bg-primary" />
      <header className="canvas-node-drag-handle mb-3 flex cursor-grab items-center justify-between active:cursor-grabbing">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          <Sparkles size={14} /> {data.label}
        </div>
        {data.onClose && !data.draft.sending && (
          <button type="button" className="nodrag text-muted-foreground hover:text-foreground" onClick={data.onClose} aria-label={copy.closeComposer}><X size={15} /></button>
        )}
      </header>
      <textarea
        autoFocus
        value={data.draft.text}
        onChange={(event) => data.onTextChange(event.target.value)}
        placeholder={copy.composerPlaceholder}
        className="nodrag nowheel min-h-28 w-full resize-y rounded-2xl border border-border bg-background/65 px-3 py-3 text-sm outline-none focus:border-primary"
        disabled={data.draft.sending}
      />
      {data.draft.files.length > 0 && (
        <div className="nodrag mt-3 grid gap-2">
          {data.draft.files.map((file, index) => (
            <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-2 rounded-xl bg-secondary/75 px-2 py-2 text-xs">
              {file.type.startsWith('image/') && data.draft.previews[`${file.name}-${file.lastModified}`]
                ? <img src={data.draft.previews[`${file.name}-${file.lastModified}`]} alt="" className="size-9 rounded-lg object-cover" />
                : <File size={15} />}
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="text-muted-foreground">{formatBytes(file.size)}</span>
              <button type="button" onClick={() => data.onRemoveFile(index)} disabled={data.draft.sending}><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
      {data.draft.error && <p translate="no" className="notranslate nodrag mt-2 flex items-start gap-2 text-xs text-destructive"><AlertCircle size={14} />{data.draft.error}</p>}
      <footer className="nodrag mt-3 flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={data.draft.sending || data.draft.files.length >= MAX_ATTACHMENTS}>
          <Paperclip size={14} /> {copy.addAttachment}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            data.onFiles(Array.from(event.target.files || []));
            event.target.value = '';
          }}
        />
        <CanvasSendButton
          sending={data.draft.sending}
          disabled={data.draft.sending || (!data.draft.text.trim() && data.draft.files.length === 0)}
          onSend={data.onSend}
        />
      </footer>
    </section>
  );
}

const nodeTypes = { interaction: InteractionNode, composer: ComposerNode };

function autoLayout(nodes: CanvasFlowNode[], edges: Edge[]): CanvasFlowNode[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', ranksep: NODE_HORIZONTAL_GAP, nodesep: NODE_VERTICAL_GAP, marginx: 40, marginy: 40 });
  nodes.forEach((node) => graph.setNode(node.id, {
    width: node.type === 'composer' ? COMPOSER_NODE_WIDTH : INTERACTION_NODE_WIDTH,
    height: DEFAULT_NODE_HEIGHT,
  }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  return nodes.map((node) => {
    const position = graph.node(node.id) as { x: number; y: number };
    const width = node.type === 'composer' ? COMPOSER_NODE_WIDTH : INTERACTION_NODE_WIDTH;
    return { ...node, position: { x: position.x - width / 2, y: position.y - DEFAULT_NODE_HEIGHT / 2 } };
  });
}

function nodeBounds(node: CanvasFlowNode, rendered?: CanvasFlowNode): CanvasNodeBounds {
  const fallbackWidth = node.type === 'composer' ? COMPOSER_NODE_WIDTH : INTERACTION_NODE_WIDTH;
  return {
    id: node.id,
    position: node.position,
    width: rendered?.measured?.width || node.measured?.width || fallbackWidth,
    height: rendered?.measured?.height || node.measured?.height || DEFAULT_NODE_HEIGHT,
  };
}

export interface CanvasContextStats {
  branchCount: number;
  sessionCount: number;
  usedTokens?: number;
  contextLimit?: number;
}

export function CanvasPanel({ onContextStatsChange }: { onContextStatsChange?: (stats: CanvasContextStats) => void }) {
  const { rpc, subscribe, connectionState, capabilities } = useGateway();
  const { language } = useSettings();
  const copy = getCanvasCopy(language);
  const appCopy = getAppCopy(language);
  const localizeError = useCallback((cause: unknown, fallback: string) => canvasErrorMessage(cause, fallback, language), [language]);
  const [canvases, setCanvases] = useState<CanvasSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [graph, setGraph] = useState<CanvasGraph | null>(null);
  const [nodes, setNodes] = useState<CanvasFlowNode[]>([]);
  const [drafts, setDrafts] = useState<Record<string, CanvasDraft>>({});
  const [activities, setActivities] = useState<Record<string, AgentActivity>>({});
  const [error, setError] = useState<string | null>(null);
  const [canvasListVisible, setCanvasListVisible] = useState(true);
  const [editingCanvasId, setEditingCanvasId] = useState<string | null>(null);
  const [editingCanvasName, setEditingCanvasName] = useState('');
  const [agents, setAgents] = useState<GatewayAgentOption[]>([]);
  const [agentCatalogError, setAgentCatalogError] = useState(false);
  const [agentCatalogLoading, setAgentCatalogLoading] = useState(false);
  const [agentChanging, setAgentChanging] = useState(false);
  const activeRuns = useRef(new Map<string, { interactionId: string; branchId: string; sessionKey: string }>());
  const saveTimer = useRef<number | null>(null);
  const nodesRef = useRef<CanvasFlowNode[]>([]);
  const positionsRef = useRef<Record<string, XYPosition>>({});
  const viewportRef = useRef<Viewport | undefined>(undefined);
  const loadedCanvasRef = useRef<string | null>(null);
  const knownLayoutNodeIdsRef = useRef(new Set<string>());

  const loadCanvases = useCallback(async () => {
    const list = await canvasApi.list();
    setCanvases(list);
    setSelectedId((current) => current && list.some((item) => item.id === current) ? current : list[0]?.id || null);
  }, []);

  const loadGraph = useCallback(async () => {
    if (!selectedId) { setGraph(null); return; }
    let nextGraph = await canvasApi.graph(selectedId);
    if (nextGraph.branches.length === 0 && nextGraph.interactions.length === 0) {
      await canvasApi.createRoot(selectedId);
      nextGraph = await canvasApi.graph(selectedId);
    }
    if (loadedCanvasRef.current !== selectedId) {
      loadedCanvasRef.current = selectedId;
      positionsRef.current = { ...(nextGraph.layout?.nodes || {}) };
      viewportRef.current = nextGraph.layout?.viewport;
      nodesRef.current = [];
      knownLayoutNodeIdsRef.current = new Set(Object.keys(nextGraph.layout?.nodes || {}));
      setNodes([]);
    } else {
      positionsRef.current = { ...(nextGraph.layout?.nodes || {}), ...positionsRef.current };
    }
    setGraph((current) => {
      if (!current || current.canvas.id !== nextGraph.canvas.id) return nextGraph;
      const localOutput = new Map(current.interactions.map((interaction) => [interaction.id, interaction.agentOutput]));
      return {
        ...nextGraph,
        interactions: nextGraph.interactions.map((interaction) => interaction.status === 'streaming' && !interaction.agentOutput && localOutput.get(interaction.id)
          ? { ...interaction, agentOutput: localOutput.get(interaction.id)! }
          : interaction),
      };
    });
    setActivities((current) => {
      const next = { ...current };
      for (const interaction of nextGraph.interactions) {
        const phase = reconciliationMetadata(interaction).phase;
        if (interaction.status !== 'streaming') delete next[interaction.branchId];
        else if (phase === 'settling') next[interaction.branchId] = 'settling';
      }
      return next;
    });
  }, [selectedId]);

  useEffect(() => { void loadCanvases().catch((cause) => setError(localizeError(cause, copy.loadCanvasListFailed))); }, [copy.loadCanvasListFailed, loadCanvases, localizeError]);
  useEffect(() => { void loadGraph().catch((cause) => setError(localizeError(cause, copy.loadCanvasFailed))); }, [copy.loadCanvasFailed, loadGraph, localizeError]);
  const loadAgents = useCallback(async () => {
    if (connectionState !== 'connected') return;
    setAgentCatalogLoading(true);
    setAgentCatalogError(false);
    try {
      const result = await rpc('agents.list', {}) as { agents?: GatewayAgentOption[] };
      setAgents(Array.isArray(result.agents) ? result.agents.filter((agent) => typeof agent.id === 'string' && agent.id) : []);
    } catch {
      setAgentCatalogError(true);
    } finally {
      setAgentCatalogLoading(false);
    }
  }, [connectionState, rpc]);
  useEffect(() => { void loadAgents(); }, [loadAgents]);
  const refreshContextStats = useCallback(async () => {
    if (!graph || connectionState !== 'connected') {
      onContextStatsChange?.({ branchCount: graph?.branches.length || 0, sessionCount: 0 });
      return;
    }
    const branchKeys = new Set(graph.branches.map((branch) => branch.sessionKey));
    try {
      const response = await rpc('sessions.list', { limit: 1000 }) as { sessions?: Array<{ key?: string; sessionKey?: string; totalTokens?: number; contextTokens?: number }> };
      const matched = (Array.isArray(response.sessions) ? response.sessions : []).filter((session) => branchKeys.has(session.sessionKey || session.key || ''));
      const usedTokens = matched.reduce((sum, session) => sum + (typeof session.totalTokens === 'number' && session.totalTokens > 0 ? session.totalTokens : 0), 0);
      const withCapacity = matched.filter((session) => typeof session.contextTokens === 'number' && session.contextTokens > 0);
      const contextLimit = withCapacity.reduce((sum, session) => sum + (session.contextTokens || 0), 0);
      onContextStatsChange?.({ branchCount: graph.branches.length, sessionCount: matched.length, ...(contextLimit > 0 ? { usedTokens, contextLimit } : {}) });
    } catch {
      onContextStatsChange?.({ branchCount: graph.branches.length, sessionCount: 0 });
    }
  }, [connectionState, graph, onContextStatsChange, rpc]);
  useEffect(() => {
    void refreshContextStats();
    if (connectionState !== 'connected') return;
    const timer = window.setInterval(() => void refreshContextStats(), 30_000);
    return () => window.clearInterval(timer);
  }, [refreshContextStats, connectionState]);
  useEffect(() => {
    if (!graph?.interactions.some((interaction) => needsReconciliation(interaction, graph.reconciliationVersion))) return;
    const timer = window.setInterval(() => {
      void loadGraph().catch((cause) => setError(localizeError(cause, copy.refreshOpenClawFailed)));
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [copy.refreshOpenClawFailed, graph, loadGraph, localizeError]);
  useEffect(() => {
    if (connectionState !== 'connected' || !graph) return;
    for (const interaction of graph.interactions.filter((candidate) => needsReconciliation(candidate, graph.reconciliationVersion))) {
      void canvasApi.reconcile(interaction.id).catch(() => undefined);
    }
  }, [connectionState, graph]);
  useEffect(() => {
    if (!graph) return;
    const interactions = new Map(graph.interactions.map((interaction) => [interaction.id, interaction]));
    for (const [runKey, active] of activeRuns.current) {
      const interaction = interactions.get(active.interactionId);
      if (interaction && interaction.status !== 'streaming'
        && reconciliationMetadata(interaction).artifactSync !== 'pending') {
        activeRuns.current.delete(runKey);
      }
    }
  }, [graph]);

  const persistLayout = useCallback((canvasId = selectedId) => {
    if (!canvasId) return Promise.resolve();
    const layout = { nodes: { ...positionsRef.current }, ...(viewportRef.current ? { viewport: viewportRef.current } : {}) };
    return canvasApi.saveLayout(canvasId, layout);
  }, [selectedId]);

  const updateDraft = useCallback((branchId: string, update: (draft: CanvasDraft) => CanvasDraft) => {
    setDrafts((current) => ({ ...current, [branchId]: update(current[branchId] || EMPTY_DRAFT) }));
  }, []);

  const handleFiles = useCallback((branchId: string, incoming: File[]) => {
    updateDraft(branchId, (draft) => {
      const accepted: File[] = [];
      for (const file of incoming.slice(0, MAX_ATTACHMENTS - draft.files.length)) {
        accepted.push(file);
      }
      const previews = { ...draft.previews };
      accepted.filter((file) => file.type.startsWith('image/')).forEach((file) => {
        previews[`${file.name}-${file.lastModified}`] = URL.createObjectURL(file);
      });
      return { ...draft, files: [...draft.files, ...accepted], previews, error: null };
    });
  }, [updateDraft]);

  const removeFile = useCallback((branchId: string, index: number) => {
    updateDraft(branchId, (draft) => {
      const file = draft.files[index];
      const key = file ? `${file.name}-${file.lastModified}` : '';
      if (key && draft.previews[key]) URL.revokeObjectURL(draft.previews[key]);
      return { ...draft, files: draft.files.filter((_, itemIndex) => itemIndex !== index) };
    });
  }, [updateDraft]);

  const send = useCallback(async (branch: CanvasBranch) => {
    const draft = drafts[branch.id] || EMPTY_DRAFT;
    if (draft.sending || (!draft.text.trim() && draft.files.length === 0)) return;
    const composerSource = branch.sessionState === 'draft'
      ? branch.forkedFromInteractionId
      : branch.headInteractionId;
    const composerId = composerNodeId(branch.id, composerSource);
    const composerPosition = positionsRef.current[composerId]
      || nodesRef.current.find((node) => node.id === composerId)?.position;
    updateDraft(branch.id, (current) => ({ ...current, sending: true, error: null }));
    setActivities((current) => ({ ...current, [branch.id]: 'queued' }));
    let reservationId: string | null = null;
    try {
      const canvasAgentId = graph?.canvas.agentId;
      const canvasId = graph?.canvas.id;
      if (!canvasId || !canvasAgentId) throw new CanvasLocalizedError(copy.currentCanvasMissing);
      if (!capabilities.methods.has('chat.send')) {
        throw new CanvasLocalizedError('当前 OpenClaw Gateway 未声明 chat.send 能力，请升级 Gateway 后重试。');
      }
      const preparedDraftAttachments = await prepareGatewayAttachments(draft.files, language);
      if (capabilities.maxPayload) {
        const estimatedBytes = estimateChatSendFrameBytes(
          branch.sessionKey,
          draft.text,
          preparedDraftAttachments,
        );
        if (estimatedBytes > capabilities.maxPayload) {
          throw new CanvasLocalizedError(
            `附件发送请求约为 ${Math.ceil(estimatedBytes / 1024 / 1024)} MiB，超过 Gateway 的 `
            + `${Math.floor(capabilities.maxPayload / 1024 / 1024)} MiB 限制。`,
          );
        }
      }
      const attachmentMeta = draft.files.length ? await persistCanvasFiles(draft.files, canvasId) : [];
      const reservation = await canvasApi.prepareSend(branch.id, {
        expectedHeadInteractionId: branch.sessionState === 'active' ? branch.headInteractionId : null,
        expectedAgentId: canvasAgentId,
        userInput: draft.text,
        attachments: attachmentMeta,
      });
      reservationId = reservation.id;
      let outgoingMessage = reservation.outgoingMessage;
      const bootstrapFiles: File[] = [];
      const bootstrapWarnings: string[] = [];
      for (const resource of reservation.bootstrapResources || []) {
        try {
          if (!resource.fetchUrl) throw new Error(copy.secureReadUrlMissing);
          const response = await fetch(resource.fetchUrl, { credentials: 'include' });
          if (!response.ok) throw new Error(copy.readFailedWithStatus(response.status));
          const blob = await response.blob();
          bootstrapFiles.push(new globalThis.File([blob], resource.name, { type: resource.mimeType || blob.type || 'application/octet-stream' }));
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : copy.readFailed;
          bootstrapWarnings.push(copy.resourceWarning(resource.name, reason));
        }
      }
      const gatewayAttachments: GatewayAttachment[] = [];
      for (const file of bootstrapFiles) {
        try { gatewayAttachments.push(await prepareGatewayAttachment(file, language)); }
        catch (cause) {
          bootstrapWarnings.push(copy.resourceWarning(file.name, cause instanceof Error ? cause.message : copy.prepareAttachmentFailed));
        }
      }
      gatewayAttachments.push(...preparedDraftAttachments);
      if (bootstrapWarnings.length > 0) {
        outgoingMessage += `\n\n<canvas-context-resource-warnings>${JSON.stringify(bootstrapWarnings)}</canvas-context-resource-warnings>`;
      }
      const ack = await sendChatMessage({
        rpc,
        sessionKey: reservation.sessionKey,
        text: outgoingMessage,
        attachments: gatewayAttachments,
        idempotencyKey: reservation.id,
      });
      const interaction = await canvasApi.acknowledge(reservation.id, ack.runId, bootstrapWarnings);
      const runKey = ack.runId || `session:${reservation.sessionKey}`;
      activeRuns.current.set(runKey, { interactionId: interaction.id, branchId: branch.id, sessionKey: reservation.sessionKey });
      if (composerPosition) {
        positionsRef.current = { ...positionsRef.current, [interaction.id]: composerPosition };
        delete positionsRef.current[composerId];
        await persistLayout();
      }
      setActivities((current) => ({ ...current, [branch.id]: 'working' }));
      updateDraft(branch.id, () => EMPTY_DRAFT);
      await loadGraph();
    } catch (cause) {
      const message = localizeError(cause, copy.messageSendFailed);
      if (reservationId) await canvasApi.failReservation(reservationId, message).catch(() => undefined);
      updateDraft(branch.id, (current) => ({ ...current, sending: false, error: message }));
      setActivities((current) => ({ ...current, [branch.id]: 'failed' }));
    }
  }, [capabilities.maxPayload, capabilities.methods, copy, drafts, graph?.canvas.agentId, graph?.canvas.id, language, loadGraph, localizeError, persistLayout, rpc, updateDraft]);

  useEffect(() => subscribe((event: GatewayEvent) => {
    const classified = classifyStreamEvent(event);
    if (!classified) return;
    const payload = (event.payload || {}) as ChatEventPayload;
    const runKey = classified.runId || (payload.sessionKey ? `session:${payload.sessionKey}` : '');
    const active = activeRuns.current.get(runKey);
    if (!active || (payload.sessionKey && payload.sessionKey !== active.sessionKey)) return;

    if (classified.type === 'chat_delta' && classified.chatPayload) {
      const delta = extractStreamDelta(classified.chatPayload);
      if (delta?.cleaned) {
        setGraph((current) => current ? {
          ...current,
          interactions: current.interactions.map((item) => item.id === active.interactionId ? { ...item, agentOutput: delta.cleaned } : item),
        } : current);
      }
      setActivities((current) => ({ ...current, [active.branchId]: 'working' }));
      return;
    }

    if (classified.type === 'chat_final' && classified.chatPayload) {
      setActivities((current) => ({ ...current, [active.branchId]: 'settling' }));
      void canvasApi.reconcile(active.interactionId, { terminalHint: true, runId: classified.runId })
        .then(loadGraph);
      return;
    }

    if (classified.type === 'chat_error' || classified.type === 'chat_aborted') {
      const reason = payload.errorMessage || payload.error || payload.stopReason || copy.openClawRunFailed;
      setActivities((current) => ({ ...current, [active.branchId]: 'settling' }));
      void canvasApi.reconcile(active.interactionId, {
        terminalHint: true,
        failureHint: reason,
        runId: classified.runId,
      }).then(loadGraph);
    }
  }), [copy.openClawRunFailed, loadGraph, subscribe]);

  const addFromInteraction = useCallback(async (interaction: CanvasInteraction) => {
    try {
      const branch = await canvasApi.fork(interaction.id);
      setDrafts((current) => ({ ...current, [branch.id]: current[branch.id] || EMPTY_DRAFT }));
      await loadGraph();
    } catch (cause) { setError(localizeError(cause, copy.forkFailed)); }
  }, [copy.forkFailed, loadGraph, localizeError]);

  const flow = useMemo(() => {
    if (!graph) return { nodes: [] as CanvasFlowNode[], edges: [] as Edge[] };
    const renderedById = new Map(nodesRef.current.map((node) => [node.id, node]));
    const interactionById = new Map(graph.interactions.map((interaction) => [interaction.id, interaction]));
    const headIds = new Set(graph.branches.map((branch) => branch.headInteractionId).filter(Boolean));
    const draftForkSources = new Set(graph.branches.filter((branch) => branch.kind === 'fork' && branch.sessionState === 'draft').map((branch) => branch.forkedFromInteractionId));
    const interactionNodes: CanvasFlowNode[] = graph.interactions.map((interaction) => ({
      id: interaction.id,
      type: 'interaction',
      position: positionsRef.current[interaction.id]
        || graph.layout?.nodes[interaction.id]
        || (headIds.has(interaction.id)
          ? positionsRef.current[composerNodeId(interaction.branchId, interaction.parentInteractionId)]
          : undefined)
        || { x: 0, y: 0 },
      dragHandle: '.canvas-node-drag-handle',
      data: {
        interaction,
        activity: activities[interaction.branchId]
          || reconciledActivity(interaction),
        composerOpen: draftForkSources.has(interaction.id),
        canAdd: !headIds.has(interaction.id) && interaction.status === 'completed' && !draftForkSources.has(interaction.id),
        onAdd: addFromInteraction,
      },
    }));
    const edges: Edge[] = graph.interactions.filter((interaction) => interaction.parentInteractionId).map((interaction) => ({
      id: `edge-${interaction.parentInteractionId}-${interaction.id}`,
      source: interaction.parentInteractionId!, target: interaction.id, animated: interaction.status === 'streaming',
    }));
    const composerNodes: CanvasFlowNode[] = [];
    for (const branch of graph.branches) {
      const isInitialDraft = branch.sessionState === 'draft';
      const head = branch.headInteractionId ? interactionById.get(branch.headInteractionId) : undefined;
      const isContinue = branch.sessionState === 'active' && head?.status === 'completed';
      if (!isInitialDraft && !isContinue) continue;
      const source = isInitialDraft ? branch.forkedFromInteractionId : branch.headInteractionId;
      const nodeId = composerNodeId(branch.id, source);
      if (source) edges.push({ id: `edge-${source}-${nodeId}`, source, target: nodeId, animated: true });
      const sourceNode = source ? interactionNodes.find((node) => node.id === source) : undefined;
      const occupied = [...interactionNodes, ...composerNodes].map((node) => nodeBounds(node, renderedById.get(node.id)));
      const defaultPosition = sourceNode
        ? placeNodeToRight(nodeBounds(sourceNode, renderedById.get(sourceNode.id)), occupied, {
          width: COMPOSER_NODE_WIDTH,
          height: renderedById.get(nodeId)?.measured?.height || DEFAULT_NODE_HEIGHT,
        })
        : placeRootNode(occupied, { width: COMPOSER_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
      composerNodes.push({
        id: nodeId,
        type: 'composer',
        position: positionsRef.current[nodeId] || graph.layout?.nodes[nodeId] || defaultPosition,
        dragHandle: '.canvas-node-drag-handle',
        data: {
          branch,
          draft: drafts[branch.id] || EMPTY_DRAFT,
          label: branch.kind === 'fork' && branch.sessionState === 'draft' ? copy.createBranch : branch.sessionState === 'draft' ? copy.newSession : copy.continueBranch,
          onTextChange: (value) => updateDraft(branch.id, (draft) => ({ ...draft, text: value, error: null })),
          onFiles: (files) => handleFiles(branch.id, files),
          onRemoveFile: (index) => removeFile(branch.id, index),
          onSend: () => void send(branch),
        },
      });
    }
    const all = [...interactionNodes, ...composerNodes];
    const hasSavedLayout = Boolean(Object.keys(positionsRef.current).length || (graph.layout && Object.keys(graph.layout.nodes).length));
    return { nodes: hasSavedLayout ? all : autoLayout(all, edges), edges };
  }, [activities, addFromInteraction, copy, drafts, graph, handleFiles, removeFile, send, updateDraft]);

  useEffect(() => {
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]));
      const next = flow.nodes.map((node) => {
        const existing = currentById.get(node.id);
        return existing
          ? { ...existing, ...node, position: existing.position, measured: existing.measured }
          : node;
      });
      nodesRef.current = next;
      positionsRef.current = mergeVisibleNodePositions(
        positionsRef.current,
        Object.fromEntries(next.map((node) => [node.id, node.position])),
      );
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
      return next;
    });
    if (!selectedId || changes.every((change) => change.type !== 'position')) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persistLayout().catch((cause) => setError(localizeError(cause, copy.saveLayoutFailed)));
    }, 500);
  }, [copy.saveLayoutFailed, localizeError, persistLayout, selectedId]);

  const onMoveEnd = useCallback((_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    if (!selectedId) return;
    viewportRef.current = viewport;
    void persistLayout().catch((cause) => setError(localizeError(cause, copy.saveLayoutFailed)));
  }, [copy.saveLayoutFailed, localizeError, persistLayout, selectedId]);

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
  }, [copy.renameCanvasFailed, editingCanvasName, localizeError]);

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
            <div><div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{copy.canvasList}</div><div className="mt-1 text-[0.667rem] text-muted-foreground">{graph ? copy.agentLabel(graph.canvas.agentId) : appCopy.tagline}</div></div>
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
              <div><div className="text-sm font-semibold">{graph.canvas.name}</div><div translate="no" className="notranslate text-[0.667rem] text-muted-foreground">{connectionState === 'connected' ? copy.connected : copy.unavailable}</div></div>
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
            </div>
            <ReactFlow
              key={selectedId}
              nodes={nodes}
              edges={flow.edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onMoveEnd={onMoveEnd}
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
