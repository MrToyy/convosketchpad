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
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/features/markdown/MarkdownRenderer';
import { useGateway } from '@/contexts/GatewayContext';
import { classifyStreamEvent, extractStreamDelta } from '@/features/chat/operations';
import { appendUploadManifest } from '@/features/chat/operations/sendMessage';
import type { UploadAttachmentDescriptor } from '@/features/chat/types';
import type { ChatEventPayload, GatewayEvent } from '@/types';
import { canvasApi, canvasArtifactUrl, stageCanvasFiles, type StagedUpload } from './api';
import { prepareGatewayAttachment, prepareGatewayAttachments, type GatewayAttachment } from './attachments';
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

function nextCanvasName(canvases: CanvasSummary[]): string {
  const names = new Set(canvases.map((canvas) => canvas.name));
  let index = 1;
  while (names.has(`画布 ${index}`)) index += 1;
  return `画布 ${index}`;
}

interface InteractionNodeData extends Record<string, unknown> {
  interaction: CanvasInteraction;
  activity: AgentActivity;
  composerOpen: boolean;
  canAdd: boolean;
  onAdd: (interaction: CanvasInteraction) => void;
  onPreviewImage: (uri: string, name: string) => void;
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

function interactionStatusLabel(interaction: CanvasInteraction, activity: AgentActivity): string {
  if (activity === 'queued') return '等待智能体响应';
  if (activity === 'working') return '智能体工作中';
  if (activity === 'settling') return '正在整理完整回复';
  if (interaction.status === 'streaming') return '生成中';
  if (interaction.status === 'completed') return '已完成';
  return '失败';
}

function reconciliationMetadata(interaction: CanvasInteraction): { phase?: string; artifactSync?: string; version?: number } {
  const value = interaction.sessionMetadata.reconciliation;
  return value && typeof value === 'object' ? value as { phase?: string; artifactSync?: string; version?: number } : {};
}

function needsReconciliation(interaction: CanvasInteraction): boolean {
  const reconciliation = reconciliationMetadata(interaction);
  return interaction.status === 'streaming' || reconciliation.artifactSync === 'pending' || reconciliation.version !== 2;
}

function reconciledActivity(interaction: CanvasInteraction): AgentActivity {
  const phase = reconciliationMetadata(interaction).phase;
  if (phase === 'settling') return 'settling';
  if (phase === 'monitoring') return 'working';
  return interaction.status === 'streaming' ? 'unknown' : 'idle';
}

function translateCanvasError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  const translations: Record<string, string> = {
    not_found: '未找到对应内容',
    invalid_branch_transition: '分支状态已变化，请刷新后重试',
    send_in_progress: '该分支已有消息正在发送',
    cannot_fork_branch_head: '分支末尾只能继续对话，不能创建分支',
    interaction_not_completed: '只能从已完成的历史交互创建分支',
    reservation_not_prepared: '发送请求已失效，请重试',
    conflict: '当前位置已有一个未发送的输入框',
    'Not found': '未找到对应内容',
    'Invalid canvas': '画布信息无效',
    'Invalid name': '画布名称无效',
    'Authentication required': '请先登录',
    'Invalid send request': '发送内容无效',
    'Message or attachment required': '请输入消息或添加附件',
    'Video attachments are not supported in Canvas': '画布暂不支持视频附件',
    'Invalid layout': '画布布局数据无效',
    'Invalid acknowledgement': '发送确认信息无效',
    'Invalid failure': '发送失败信息无效',
    'Invalid completion': '交互完成信息无效',
    'Canvas operation failed': '画布操作失败',
    'Failed to fetch': '无法连接到服务端',
  };
  return translations[message] || (/[一-鿿]/.test(message) ? message : fallback);
}

function InteractionNode({ data }: NodeProps<InteractionFlowNode>) {
  const { interaction, activity, composerOpen, canAdd, onAdd, onPreviewImage } = data;
  const bootstrapWarnings = Array.isArray(interaction.sessionMetadata.bootstrapWarnings)
    ? interaction.sessionMetadata.bootstrapWarnings.filter((item): item is string => typeof item === 'string')
    : [];
  return (
    <article className="w-[380px] rounded-3xl border border-border/80 bg-card/96 p-4 shadow-2xl backdrop-blur">
      <Handle type="target" position={Position.Left} className="!bg-primary" />
      <header className="canvas-node-drag-handle flex cursor-grab items-center justify-between gap-3 active:cursor-grabbing">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-2 rounded-full ${activity === 'working' || activity === 'queued' || activity === 'settling' ? 'animate-pulse bg-primary' : interaction.status === 'failed' ? 'bg-destructive' : 'bg-green'}`} />
          <span className="truncate text-[0.667rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {interactionStatusLabel(interaction, activity)}
          </span>
        </div>
        <time className="text-[0.667rem] text-muted-foreground">{new Date(interaction.createdAt).toLocaleTimeString()}</time>
      </header>

      <details className="nodrag mt-3 cursor-text select-text rounded-2xl border border-border/60 bg-background/45 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">用户输入</summary>
        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{interaction.userInput || '（仅包含附件）'}</p>
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
          <div className="flex items-center gap-2 py-4 text-muted-foreground"><Loader2 size={15} className="animate-spin" /> {activity === 'settling' ? '正在整理完整回复…' : '正在等待 OpenClaw 响应…'}</div>
        ) : interaction.agentOutput ? (
          <MarkdownRenderer content={interaction.agentOutput} />
        ) : (
          <p className="py-3 text-muted-foreground">暂无响应内容。</p>
        )}
      </div>

      {bootstrapWarnings.length > 0 && (
        <div className="nodrag mt-3 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <div className="flex items-center gap-2 font-medium"><AlertCircle size={14} />部分历史资源未能继承</div>
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
            return (
              <div key={`${artifact.uri}-${index}`} className="overflow-hidden rounded-2xl border border-border/60 bg-background/45">
                {isImage && (
                  <button
                    type="button"
                    onClick={() => onPreviewImage(canvasArtifactUrl(artifact.uri), artifact.name)}
                    className="block w-full cursor-zoom-in bg-black/10"
                    aria-label={`预览图片 ${artifact.name}`}
                  >
                    <img src={canvasArtifactUrl(artifact.uri)} alt={artifact.name} className="max-h-56 w-full object-contain" />
                  </button>
                )}
                <a href={canvasArtifactUrl(artifact.uri)} target="_blank" rel="noreferrer" download className="flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-secondary/70">
                  <Icon size={14} /><span className="min-w-0 flex-1 truncate">{artifact.name}</span><Download size={13} />
                </a>
              </div>
            );
          })}
        </div>
      )}

      {!composerOpen && canAdd && (
        <button
          type="button"
          onClick={() => onAdd(interaction)}
          title="从此交互创建新分支"
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
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <section className="w-[360px] rounded-3xl border border-primary/35 bg-card/98 p-4 shadow-2xl">
      <Handle type="target" position={Position.Left} className="!bg-primary" />
      <header className="canvas-node-drag-handle mb-3 flex cursor-grab items-center justify-between active:cursor-grabbing">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          <Sparkles size={14} /> {data.label}
        </div>
        {data.onClose && !data.draft.sending && (
          <button type="button" className="nodrag text-muted-foreground hover:text-foreground" onClick={data.onClose} aria-label="关闭输入框"><X size={15} /></button>
        )}
      </header>
      <textarea
        autoFocus
        value={data.draft.text}
        onChange={(event) => data.onTextChange(event.target.value)}
        placeholder="接下来希望 OpenClaw 做什么？"
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
      {data.draft.error && <p className="nodrag mt-2 flex items-start gap-2 text-xs text-destructive"><AlertCircle size={14} />{data.draft.error}</p>}
      <footer className="nodrag mt-3 flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={data.draft.sending || data.draft.files.length >= MAX_ATTACHMENTS}>
          <Paperclip size={14} /> 添加附件
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
        <Button type="button" size="sm" onClick={data.onSend} disabled={data.draft.sending || (!data.draft.text.trim() && data.draft.files.length === 0)}>
          {data.draft.sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          发送
        </Button>
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

function buildUploadDescriptors(staged: StagedUpload[], ids: string[]): UploadAttachmentDescriptor[] {
  return staged.map((item, index) => ({
    id: ids[index] || crypto.randomUUID(),
    origin: 'upload',
    mode: 'file_reference',
    name: item.originalName,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    reference: { kind: 'local_path', path: item.absolutePath, uri: item.uri },
    preparation: {
      sourceMode: 'file_reference', finalMode: 'file_reference', outcome: 'file_reference_ready',
      originalMimeType: item.mimeType, originalSizeBytes: item.sizeBytes,
    },
    policy: { forwardToSubagents: true },
  }));
}

export function CanvasPanel({ agentId }: { agentId: string }) {
  const { rpc, subscribe, connectionState } = useGateway();
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
  const [previewImage, setPreviewImage] = useState<{ uri: string; name: string } | null>(null);
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

  useEffect(() => { void loadCanvases().catch((cause) => setError(translateCanvasError(cause, '无法加载画布列表'))); }, [loadCanvases]);
  useEffect(() => { void loadGraph().catch((cause) => setError(translateCanvasError(cause, '无法加载画布'))); }, [loadGraph]);
  useEffect(() => { setPreviewImage(null); }, [selectedId]);
  useEffect(() => {
    if (!previewImage) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewImage(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [previewImage]);
  useEffect(() => {
    if (!graph?.interactions.some(needsReconciliation)) return;
    const timer = window.setInterval(() => {
      void loadGraph().catch((cause) => setError(translateCanvasError(cause, '无法刷新 OpenClaw 状态')));
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [graph, loadGraph]);
  useEffect(() => {
    if (connectionState !== 'connected' || !graph) return;
    for (const interaction of graph.interactions.filter(needsReconciliation)) {
      void canvasApi.reconcile(interaction.id).catch(() => undefined);
    }
  }, [connectionState, graph]);

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
      const canvasAgentId = graph?.canvas.agentId || agentId;
      const canvasId = graph?.canvas.id;
      if (!canvasId) throw new Error('未找到当前画布');
      const staged = draft.files.length ? await stageCanvasFiles(draft.files, canvasAgentId, canvasId) : [];
      const attachmentIds = staged.map(() => crypto.randomUUID());
      const attachmentMeta = staged.map((item, index) => ({
        id: attachmentIds[index],
        name: item.originalName, mimeType: item.mimeType, sizeBytes: item.sizeBytes,
        mode: 'file_reference' as const, uri: item.uri, workspacePath: item.canonicalPath,
      }));
      const reservation = await canvasApi.prepareSend(branch.id, {
        expectedHeadInteractionId: branch.sessionState === 'active' ? branch.headInteractionId : null,
        userInput: draft.text,
        attachments: attachmentMeta,
      });
      reservationId = reservation.id;
      const descriptors = buildUploadDescriptors(staged, attachmentIds);
      let outgoingMessage = appendUploadManifest(reservation.outgoingMessage, descriptors.length ? {
        descriptors,
        manifest: { enabled: true, exposeInlineBase64ToAgent: false, allowSubagentForwarding: true },
      } : undefined);
      const bootstrapFiles: File[] = [];
      const bootstrapWarnings: string[] = [];
      for (const resource of reservation.bootstrapResources || []) {
        try {
          if (!resource.fetchUrl) throw new Error('缺少安全读取地址');
          const response = await fetch(resource.fetchUrl, { credentials: 'include' });
          if (!response.ok) throw new Error(`读取失败（${response.status}）`);
          const blob = await response.blob();
          bootstrapFiles.push(new globalThis.File([blob], resource.name, { type: resource.mimeType || blob.type || 'application/octet-stream' }));
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : '读取失败';
          bootstrapWarnings.push(`${resource.name}：${reason}`);
        }
      }
      const gatewayAttachments: GatewayAttachment[] = [];
      for (const file of bootstrapFiles) {
        try { gatewayAttachments.push(await prepareGatewayAttachment(file)); }
        catch (cause) {
          bootstrapWarnings.push(`${file.name}：${cause instanceof Error ? cause.message : '无法准备附件'}`);
        }
      }
      gatewayAttachments.push(...await prepareGatewayAttachments(draft.files));
      if (bootstrapWarnings.length > 0) {
        outgoingMessage += `\n\n<canvas-context-resource-warnings>${JSON.stringify(bootstrapWarnings)}</canvas-context-resource-warnings>`;
      }
      const rpcParams: Record<string, unknown> = {
        sessionKey: reservation.sessionKey,
        message: outgoingMessage,
        deliver: false,
        idempotencyKey: reservation.id,
      };
      if (gatewayAttachments.length > 0) rpcParams.attachments = gatewayAttachments;
      const ack = await rpc('chat.send', rpcParams) as { runId?: string };
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
      const message = translateCanvasError(cause, '消息发送失败');
      if (reservationId) await canvasApi.failReservation(reservationId, message).catch(() => undefined);
      updateDraft(branch.id, (current) => ({ ...current, sending: false, error: message }));
      setActivities((current) => ({ ...current, [branch.id]: 'failed' }));
    }
  }, [agentId, drafts, graph?.canvas.agentId, graph?.canvas.id, loadGraph, persistLayout, rpc, updateDraft]);

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
      void canvasApi.reconcile(active.interactionId, { terminalHint: true })
        .then(loadGraph)
        .finally(() => {
          activeRuns.current.delete(runKey);
        });
      return;
    }

    if (classified.type === 'chat_error' || classified.type === 'chat_aborted') {
      const reason = payload.errorMessage || payload.error || payload.stopReason || 'OpenClaw 运行失败';
      setActivities((current) => ({ ...current, [active.branchId]: 'settling' }));
      void canvasApi.reconcile(active.interactionId, { terminalHint: true, failureHint: reason })
        .then(loadGraph)
        .finally(() => {
          activeRuns.current.delete(runKey);
        });
    }
  }), [loadGraph, subscribe]);

  const addFromInteraction = useCallback(async (interaction: CanvasInteraction) => {
    try {
      const branch = await canvasApi.fork(interaction.id);
      setDrafts((current) => ({ ...current, [branch.id]: current[branch.id] || EMPTY_DRAFT }));
      await loadGraph();
    } catch (cause) { setError(translateCanvasError(cause, '无法创建新分支')); }
  }, [loadGraph]);

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
        onPreviewImage: (uri, name) => setPreviewImage({ uri, name }),
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
          label: branch.kind === 'fork' && branch.sessionState === 'draft' ? '创建分支' : branch.sessionState === 'draft' ? '新会话' : '继续分支',
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
  }, [activities, addFromInteraction, drafts, graph, handleFiles, removeFile, send, updateDraft]);

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
      void persistLayout().catch((cause) => setError(translateCanvasError(cause, '无法保存画布布局')));
    }, 100);
  }, [nodes, persistLayout, selectedId]);

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
      void persistLayout().catch((cause) => setError(translateCanvasError(cause, '无法保存画布布局')));
    }, 500);
  }, [persistLayout, selectedId]);

  const onMoveEnd = useCallback((_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    if (!selectedId) return;
    viewportRef.current = viewport;
    void persistLayout().catch((cause) => setError(translateCanvasError(cause, '无法保存画布布局')));
  }, [persistLayout, selectedId]);

  const createCanvas = useCallback(async () => {
    const name = nextCanvasName(canvases);
    try {
      const canvas = await canvasApi.create(name, agentId || 'main');
      await canvasApi.createRoot(canvas.id);
      await loadCanvases();
      setSelectedId(canvas.id);
      setEditingCanvasId(canvas.id);
      setEditingCanvasName(canvas.name);
    } catch (cause) { setError(translateCanvasError(cause, '无法创建画布')); }
  }, [agentId, canvases, loadCanvases]);

  const renameCanvas = useCallback(async (canvas: CanvasSummary) => {
    const name = editingCanvasName.trim();
    setEditingCanvasId(null);
    if (!name || name === canvas.name) return;
    try {
      const updated = await canvasApi.update(canvas.id, name);
      setCanvases((current) => current.map((item) => item.id === updated.id ? updated : item));
      setGraph((current) => current?.canvas.id === updated.id ? { ...current, canvas: updated } : current);
    } catch (cause) {
      setError(translateCanvasError(cause, '无法重命名画布'));
    }
  }, [editingCanvasName]);

  const createRoot = useCallback(async () => {
    if (!selectedId) return;
    try { await canvasApi.createRoot(selectedId); await loadGraph(); }
    catch (cause) { setError(translateCanvasError(cause, '无法创建新会话')); }
  }, [loadGraph, selectedId]);

  const deleteCanvas = useCallback(async (canvas: CanvasSummary) => {
    if (!window.confirm(`确定删除“${canvas.name}”及其画布数据吗？OpenClaw 原始会话记录不会被修改。`)) return;
    await canvasApi.remove(canvas.id);
    await loadCanvases();
  }, [loadCanvases]);

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-background">
      {canvasListVisible && (
        <aside className="flex w-64 shrink-0 flex-col border-r border-border/75 bg-card/65 p-3">
          <div className="flex items-center justify-between gap-2 px-1 py-2">
            <div><div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">画布列表</div><div className="mt-1 text-[0.667rem] text-muted-foreground">智能体：{agentId}</div></div>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" onClick={() => setCanvasListVisible(false)} title="隐藏画布列表" aria-label="隐藏画布列表"><PanelLeftClose size={15} /></Button>
              <Button size="icon" variant="outline" onClick={() => void createCanvas()} title="新建画布"><Plus size={15} /></Button>
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
                      aria-label={`重命名 ${canvas.name}`}
                      className="w-full rounded-lg border border-primary/45 bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="mt-1 px-1 text-[0.667rem] text-muted-foreground">按 Enter 保存，Esc 取消</div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setSelectedId(canvas.id)} onDoubleClick={() => { setEditingCanvasId(canvas.id); setEditingCanvasName(canvas.name); }} className="min-w-0 flex-1 rounded-xl px-3 py-2 text-left">
                    <div className="truncate text-sm font-medium">{canvas.name}</div>
                    <div className="mt-1 text-[0.667rem] text-muted-foreground">{new Date(canvas.updatedAt).toLocaleDateString()}</div>
                  </button>
                )}
                {editingCanvasId !== canvas.id && (
                  <button type="button" onClick={() => { setEditingCanvasId(canvas.id); setEditingCanvasName(canvas.name); }} className="p-2 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100" aria-label={`重命名 ${canvas.name}`} title="重命名"><Pencil size={14} /></button>
                )}
                <button type="button" onClick={() => void deleteCanvas(canvas)} className="p-2 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100" aria-label={`删除 ${canvas.name}`} title="删除画布"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </aside>
      )}

      <main className="relative min-w-0 flex-1">
        {!canvasListVisible && <Button size="icon" variant="outline" onClick={() => setCanvasListVisible(true)} className="absolute left-4 top-4 z-20 bg-card/92 shadow-lg backdrop-blur" title="显示画布列表" aria-label="显示画布列表"><PanelLeftOpen size={15} /></Button>}
        {error && <button type="button" onClick={() => setError(null)} className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-destructive/30 bg-card px-3 py-2 text-xs text-destructive"><AlertCircle size={14} />{error}<X size={13} /></button>}
        {selectedId && graph ? (
          <>
            <div className={`absolute top-4 z-10 flex items-center gap-3 rounded-2xl border border-border/75 bg-card/92 px-3 py-2 shadow-lg backdrop-blur ${canvasListVisible ? 'left-4' : 'left-16'}`}>
              <Bot size={16} className={connectionState === 'connected' ? 'text-green' : 'text-muted-foreground'} />
              <div><div className="text-sm font-semibold">{graph.canvas.name}</div><div className="text-[0.667rem] text-muted-foreground">{connectionState === 'connected' ? 'OpenClaw 已连接' : 'OpenClaw 暂不可用'}</div></div>
              <Button size="sm" onClick={() => void createRoot()}><Plus size={14} /> 新会话</Button>
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
                'controls.ariaLabel': '画布控制',
                'controls.zoomIn.ariaLabel': '放大',
                'controls.zoomOut.ariaLabel': '缩小',
                'controls.fitView.ariaLabel': '适应视图',
                'controls.interactive.ariaLabel': '切换节点交互',
                'minimap.ariaLabel': '画布缩略图',
              }}
            >
              <Background gap={24} size={1} />
              <Controls />
              <MiniMap pannable zoomable className="!bg-card" />
            </ReactFlow>
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div><Sparkles size={34} className="mx-auto text-primary" /><h2 className="mt-4 text-2xl font-semibold">开始使用 OpenClaw 画布</h2><p className="mt-2 text-sm text-muted-foreground">创建画布后，你可以开始多个独立会话，并从历史交互创建新的分支。</p><Button className="mt-5" onClick={() => void createCanvas()}><Plus size={15} /> 新建画布</Button></div>
          </div>
        )}
      </main>
      {previewImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`图片预览：${previewImage.name}`}
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="absolute right-5 top-5 flex size-10 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white hover:bg-black/70"
            aria-label="关闭图片预览"
            title="关闭预览"
          >
            <X size={22} />
          </button>
          <img
            src={previewImage.uri}
            alt={previewImage.name}
            onClick={(event) => event.stopPropagation()}
            className="max-h-full max-w-full cursor-default rounded-xl object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
