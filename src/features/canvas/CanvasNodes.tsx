/* eslint-disable react-refresh/only-export-components -- React Flow node registry and its typed layout helpers share one module */
import dagre from '@dagrejs/dagre';
import {
  Handle,
  NodeResizeControl,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  AlertCircle,
  Download,
  File,
  FileCode2,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ImageLightbox } from '@/features/chat/ImageLightbox';
import { MarkdownRenderer } from '@/features/markdown/MarkdownRenderer';
import { useSettings } from '@/contexts/SettingsContext';
import { canvasApi, canvasArtifactUrl } from './api';
import { CanvasSendButton } from './CanvasSendButton';
import { MAX_CANVAS_ATTACHMENTS } from './constants';
import {
  COMPOSER_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  INTERACTION_NODE_WIDTH,
  MAX_NODE_HEIGHT,
  MAX_NODE_WIDTH,
  MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  NODE_HORIZONTAL_GAP,
  NODE_VERTICAL_GAP,
  type CanvasNodeBounds,
} from './layout';
import { getCanvasCopy, type CanvasCopy } from './messages';
import type { CanvasBranch, CanvasDraft, CanvasInteraction, InteractionApproval } from './types';

interface InteractionNodeData extends Record<string, unknown> {
  interaction: CanvasInteraction;
  preview: string;
  composerOpen: boolean;
  canAdd: boolean;
  resubmitting: boolean;
  resizeEnabled: boolean;
  onAdd: (interaction: CanvasInteraction) => void;
  onResubmit: (interaction: CanvasInteraction) => void;
  onApprovalChanged: () => void;
}

interface ComposerNodeData extends Record<string, unknown> {
  branch: CanvasBranch;
  draft: CanvasDraft;
  label: string;
  resizeEnabled: boolean;
  onTextChange: (value: string) => void;
  onFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  onRemovePersistedAttachment: (index: number) => void;
  onSend: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onClose?: () => void;
}

type InteractionFlowNode = Node<InteractionNodeData, 'interaction'>;
type ComposerFlowNode = Node<ComposerNodeData, 'composer'>;
export type CanvasFlowNode = InteractionFlowNode | ComposerFlowNode;

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

function interactionStatusLabel(interaction: CanvasInteraction, copy: CanvasCopy): string {
  if (interaction.executionState === 'running') return copy.status.streaming;
  if (interaction.executionState === 'completed') return copy.status.completed;
  if (interaction.executionState === 'unconfirmed') return copy.status.unconfirmed;
  return copy.status.failed;
}

function CanvasNodeResizeHandle({
  enabled,
  label,
}: {
  enabled: boolean;
  label: string;
}) {
  const [resizing, setResizing] = useState(false);
  return (
    <NodeResizeControl
      position="bottom-right"
      autoScale={false}
      minWidth={MIN_NODE_WIDTH}
      minHeight={MIN_NODE_HEIGHT}
      maxWidth={MAX_NODE_WIDTH}
      maxHeight={MAX_NODE_HEIGHT}
      shouldResize={() => enabled}
      onResizeStart={() => setResizing(true)}
      onResizeEnd={() => setResizing(false)}
      style={{
        left: 'auto',
        top: 'auto',
        right: 0,
        bottom: 0,
        width: 28,
        height: 28,
        translate: 'none',
        zIndex: 10,
      }}
      className={`group/resize !border-0 !bg-transparent !shadow-none ${enabled ? '!cursor-nwse-resize' : '!cursor-not-allowed'}`}
    >
      <span
        title={label}
        data-resize-enabled={enabled}
        className="pointer-events-none relative block size-full"
      >
        <svg
          data-testid="node-resize-grip"
          viewBox="0 0 16 16"
          aria-hidden="true"
          fill="none"
          className={`absolute bottom-[5px] right-[5px] size-3.5 transition-colors duration-150 ${resizing ? 'text-primary' : enabled ? 'text-muted-foreground/50 group-hover/resize:text-primary/80' : 'text-muted-foreground/30'}`}
        >
          <path
            d="M2.75 13.25 13.25 2.75"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M7.25 13.25 13.25 7.25"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M11.25 13.25 13.25 11.25"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
    </NodeResizeControl>
  );
}

function ApprovalCard({ approval, onChanged }: {
  approval: InteractionApproval;
  onChanged: () => void;
}) {
  const { language } = useSettings();
  const [selectedPermissions, setSelectedPermissions] = useState(
    () => new Set(approval.permissions.map((permission) => permission.id)),
  );
  const [submittingChoice, setSubmittingChoice] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const pending = approval.status === 'pending';
  const riskClass = approval.risk === 'high'
    ? 'border-destructive/50 bg-destructive/10'
    : approval.risk === 'medium'
      ? 'border-orange/45 bg-orange/10'
      : 'border-border/60 bg-background/45';
  const statusLabel = language === 'zh-CN'
    ? ({ pending: '等待审批', resolving: '正在提交', resolved: '已允许', denied: '已拒绝', expired: '已过期', unconfirmed: '结果待确认' } as const)[approval.status]
    : ({ pending: 'Approval required', resolving: 'Submitting', resolved: 'Allowed', denied: 'Denied', expired: 'Expired', unconfirmed: 'Result unconfirmed' } as const)[approval.status];

  const resolve = async (choice: InteractionApproval['choices'][number]) => {
    if (choice.requiresConfirmation) {
      const confirmed = window.confirm(language === 'zh-CN'
        ? `“${choice.label}”会在 ${choice.scope} 范围内持续授权。确认继续吗？`
        : `“${choice.label}” grants access for the ${choice.scope} scope. Continue?`);
      if (!confirmed) return;
    }
    setSubmittingChoice(choice.id);
    setSubmitError(null);
    try {
      await canvasApi.resolveApproval(approval.id, {
        choiceId: choice.id,
        ...(choice.intent === 'grant' ? { grantedPermissionIds: [...selectedPermissions] } : {}),
      });
      onChanged();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Approval failed');
      onChanged();
    } finally {
      setSubmittingChoice(null);
    }
  };

  return <section className={`nodrag mt-3 rounded-2xl border px-3 py-3 ${riskClass}`} aria-label={approval.title}>
    <div className="flex items-start gap-2">
      <ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-semibold text-foreground">{approval.title}</h3>
          <span className="rounded-full border border-current/20 px-1.5 py-0.5 text-[0.6rem] uppercase">{approval.risk}</span>
          <span role="status" aria-live="polite" className="text-[0.667rem] text-muted-foreground">{statusLabel}</span>
        </div>
        {approval.description && <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-background/55 p-2 font-mono text-[0.667rem] text-muted-foreground">{approval.description}</p>}
        {approval.permissions.length > 0 && <fieldset className="mt-2 space-y-1" disabled={!pending || submittingChoice !== null}>
          <legend className="text-[0.667rem] font-medium text-muted-foreground">{language === 'zh-CN' ? '请求的权限' : 'Requested permissions'}</legend>
          {approval.permissions.map((permission) => <label key={permission.id} className="flex items-start gap-2 text-[0.667rem] text-foreground">
            <input type="checkbox" checked={selectedPermissions.has(permission.id)} onChange={(event) => setSelectedPermissions((current) => {
              const next = new Set(current);
              if (event.target.checked) next.add(permission.id); else next.delete(permission.id);
              return next;
            })} />
            <span><span className="font-medium">{permission.label}</span>{permission.description && <span className="block text-muted-foreground">{permission.description}</span>}</span>
          </label>)}
        </fieldset>}
        {approval.expiresAt && pending && <p className="mt-2 text-[0.667rem] text-muted-foreground">{language === 'zh-CN' ? '过期时间' : 'Expires'}: {new Date(approval.expiresAt).toLocaleString(language)}</p>}
        {pending && <div className="mt-3 flex flex-wrap gap-2">
          {approval.choices.map((choice) => <Button key={choice.id} type="button" size="sm" variant={choice.intent === 'deny' || choice.scope === 'persistent' ? 'outline' : 'default'} disabled={submittingChoice !== null || (choice.intent === 'grant' && selectedPermissions.size === 0)} onClick={() => void resolve(choice)}>
            {submittingChoice === choice.id && <Loader2 size={12} className="animate-spin" />}{choice.label}
          </Button>)}
        </div>}
        {(submitError || approval.error) && <p role="alert" className="mt-2 text-[0.667rem] text-destructive">{submitError || approval.error}</p>}
      </div>
    </div>
  </section>;
}

function InteractionNode({ data }: NodeProps<InteractionFlowNode>) {
  const { language } = useSettings();
  const copy = getCanvasCopy(language);
  const {
    interaction,
    preview,
    composerOpen,
    canAdd,
    resubmitting,
    resizeEnabled,
    onAdd,
    onResubmit,
    onApprovalChanged,
  } = data;
  const visibleOutput = interaction.agentOutput || preview;
  const running = interaction.executionState === 'running';
  const bootstrapWarnings = Array.isArray(interaction.executionMetadata.bootstrapWarnings)
    ? interaction.executionMetadata.bootstrapWarnings.filter((item): item is string => typeof item === 'string')
    : [];
  const imageAttachments = interaction.attachments.filter((item) =>
    item.mimeType.startsWith('image/') && Boolean(item.thumbnailUri));
  const fileAttachments = interaction.attachments.filter((item) =>
    !item.mimeType.startsWith('image/') || !item.thumbnailUri);
  return (
    <>
      <CanvasNodeResizeHandle enabled={resizeEnabled} label={copy.resizeNode} />
      <Handle type="target" position={Position.Left} className="!bg-primary" />
      <article className="h-full w-full overflow-auto rounded-3xl border border-border/80 bg-card/96 p-4 shadow-2xl backdrop-blur">
      <header className="canvas-node-drag-handle flex cursor-grab items-center justify-between gap-3 active:cursor-grabbing">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-2 rounded-full ${running ? 'animate-pulse bg-primary' : interaction.executionState === 'failed' || interaction.executionState === 'unconfirmed' ? 'bg-destructive' : 'bg-green'}`} />
          <span translate="no" className="notranslate truncate text-[0.667rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {interactionStatusLabel(interaction, copy)}
          </span>
        </div>
        <div className="nodrag flex items-center gap-2">
          <button
            type="button"
            onClick={() => onResubmit(interaction)}
            disabled={resubmitting}
            title={
              interaction.executionState === 'running' || interaction.executionState === 'unconfirmed'
                ? copy.resubmitInteractionParallel
                : copy.resubmitInteraction
            }
            aria-label={copy.resubmitInteraction}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground disabled:cursor-wait disabled:opacity-60"
          >
            <RotateCcw size={13} className={resubmitting ? 'animate-spin' : ''} />
          </button>
          <time className="text-[0.667rem] text-muted-foreground">{new Date(interaction.createdAt).toLocaleTimeString(language)}</time>
        </div>
      </header>

      <details className="nodrag mt-3 cursor-text select-text rounded-2xl border border-border/60 bg-background/45 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{copy.userInput}</summary>
        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{interaction.userInput || copy.attachmentsOnly}</p>
        {fileAttachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {fileAttachments.map((item, index) => (
              <span key={`${item.name}-${index}`} className="rounded-lg bg-secondary px-2 py-1 text-[0.667rem] text-muted-foreground">
                {item.name}
              </span>
            ))}
          </div>
        )}
      </details>

      {imageAttachments.length > 0 && (
        <div className="nodrag mt-3 grid grid-cols-2 gap-2">
          {imageAttachments.map((attachment, index) => (
            <div key={`${attachment.uri}-${index}`} className="overflow-hidden rounded-2xl border border-border/60 bg-background/45">
              <ImageLightbox
                thumbnailSrc={attachment.thumbnailUri!}
                originalSrc={attachment.uri}
                alt={attachment.name}
                thumbnailClassName="h-28 w-full cursor-zoom-in bg-black/10 object-contain"
              />
              <a href={attachment.uri} target="_blank" rel="noreferrer" download className="flex items-center gap-2 px-2 py-2 text-[0.667rem] text-foreground hover:bg-secondary/70">
                <Paperclip size={12} /><span className="min-w-0 flex-1 truncate">{attachment.name}</span><Download size={12} />
              </a>
            </div>
          ))}
        </div>
      )}

      <div className="nodrag nowheel mt-3 max-h-[360px] cursor-text select-text overflow-auto text-sm">
        {running && !visibleOutput ? (
          <div translate="no" className="notranslate flex items-center gap-2 py-4 text-muted-foreground"><Loader2 size={15} className="animate-spin" /> {copy.waitingForResponse}</div>
        ) : visibleOutput ? (
          <MarkdownRenderer content={visibleOutput} />
        ) : (
          <p translate="no" className="notranslate py-3 text-muted-foreground">{copy.noResponse}</p>
        )}
      </div>

      {(interaction.approvals || []).map((approval) => <ApprovalCard key={approval.id} approval={approval} onChanged={onApprovalChanged} />)}

      {interaction.artifactSyncState === 'observing' && (
        <div className="nodrag mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" /> {copy.artifactSyncing}
        </div>
      )}
      {interaction.artifactSyncState === 'degraded' && (
        <div className="nodrag mt-3 flex items-center gap-2 text-xs text-amber-300">
          <AlertCircle size={13} /> {copy.artifactDegraded}
        </div>
      )}

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
                  artifact.thumbnailUri
                    ? (
                      <ImageLightbox
                        thumbnailSrc={artifact.thumbnailUri}
                        originalSrc={canvasArtifactUrl(artifact.uri)}
                        alt={artifact.name}
                        thumbnailClassName="max-h-56 w-full cursor-zoom-in bg-black/10 object-contain"
                      />
                    )
                    : null
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

      </article>
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
    </>
  );
}

function ComposerNode({ data }: NodeProps<ComposerFlowNode>) {
  const { language } = useSettings();
  const copy = getCanvasCopy(language);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <CanvasNodeResizeHandle enabled={data.resizeEnabled} label={copy.resizeNode} />
      <Handle type="target" position={Position.Left} className="!bg-primary" />
      <section className="h-full w-full overflow-auto rounded-3xl border border-primary/35 bg-card/98 p-4 shadow-2xl">
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
        onFocus={data.onFocus}
        onBlur={data.onBlur}
        placeholder={copy.composerPlaceholder}
        className="nodrag nowheel min-h-28 w-full resize-none rounded-2xl border border-border bg-background/65 px-3 py-3 text-sm outline-none focus:border-primary"
        disabled={data.draft.sending}
      />
      {data.draft.persistedAttachments.length > 0 && (
        <div className="nodrag mt-3 grid gap-2">
          {data.draft.persistedAttachments.map((attachment, index) => (
            <div key={`${attachment.id}-${index}`} className="flex items-center gap-2 rounded-xl bg-secondary/75 px-2 py-2 text-xs">
              {attachment.mimeType.startsWith('image/') && attachment.thumbnailUri
                ? <img src={attachment.thumbnailUri} alt="" className="size-9 rounded-lg object-cover" />
                : <File size={15} />}
              <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
              <span className="text-muted-foreground">{formatBytes(attachment.sizeBytes)}</span>
              <button
                type="button"
                onClick={() => data.onRemovePersistedAttachment(index)}
                disabled={data.draft.sending}
                aria-label={`${copy.removeAttachment}: ${attachment.name}`}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={
            data.draft.sending
            || data.draft.files.length + data.draft.persistedAttachments.length
              >= MAX_CANVAS_ATTACHMENTS
          }
        >
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
          disabled={
            data.draft.sending
            || (
              !data.draft.text.trim()
              && data.draft.files.length === 0
              && data.draft.persistedAttachments.length === 0
            )
          }
          onSend={data.onSend}
        />
      </footer>
      </section>
    </>
  );
}

export const canvasNodeTypes = {
  interaction: InteractionNode,
  composer: ComposerNode,
};

export function autoLayoutCanvasNodes(nodes: CanvasFlowNode[], edges: Edge[]): CanvasFlowNode[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', ranksep: NODE_HORIZONTAL_GAP, nodesep: NODE_VERTICAL_GAP, marginx: 40, marginy: 40 });
  nodes.forEach((node) => {
    const fallbackWidth = node.type === 'composer' ? COMPOSER_NODE_WIDTH : INTERACTION_NODE_WIDTH;
    graph.setNode(node.id, {
      width: node.width || node.measured?.width || fallbackWidth,
      height: node.height || node.measured?.height || DEFAULT_NODE_HEIGHT,
    });
  });
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  return nodes.map((node) => {
    const position = graph.node(node.id) as { x: number; y: number };
    const fallbackWidth = node.type === 'composer' ? COMPOSER_NODE_WIDTH : INTERACTION_NODE_WIDTH;
    const width = node.width || node.measured?.width || fallbackWidth;
    const height = node.height || node.measured?.height || DEFAULT_NODE_HEIGHT;
    return { ...node, position: { x: position.x - width / 2, y: position.y - height / 2 } };
  });
}

export function canvasNodeBounds(node: CanvasFlowNode, rendered?: CanvasFlowNode): CanvasNodeBounds {
  const fallbackWidth = node.type === 'composer' ? COMPOSER_NODE_WIDTH : INTERACTION_NODE_WIDTH;
  return {
    id: node.id,
    position: node.position,
    width: rendered?.width || node.width || rendered?.measured?.width
      || node.measured?.width || fallbackWidth,
    height: rendered?.height || node.height || rendered?.measured?.height
      || node.measured?.height || DEFAULT_NODE_HEIGHT,
  };
}
