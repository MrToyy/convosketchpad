/* eslint-disable react-refresh/only-export-components -- React Flow node registry and its typed layout helpers share one module */
import dagre from '@dagrejs/dagre';
import {
  Handle,
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
  Sparkles,
  X,
} from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { ImageLightbox } from '@/features/chat/ImageLightbox';
import { MarkdownRenderer } from '@/features/markdown/MarkdownRenderer';
import { useSettings } from '@/contexts/SettingsContext';
import { canvasArtifactUrl } from './api';
import { CanvasSendButton } from './CanvasSendButton';
import { MAX_CANVAS_ATTACHMENTS } from './constants';
import {
  COMPOSER_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  INTERACTION_NODE_WIDTH,
  NODE_HORIZONTAL_GAP,
  NODE_VERTICAL_GAP,
  type CanvasNodeBounds,
} from './layout';
import { getCanvasCopy, type CanvasCopy } from './messages';
import type { CanvasBranch, CanvasDraft, CanvasInteraction } from './types';

interface InteractionNodeData extends Record<string, unknown> {
  interaction: CanvasInteraction;
  preview: string;
  composerOpen: boolean;
  canAdd: boolean;
  onAdd: (interaction: CanvasInteraction) => void;
}

interface ComposerNodeData extends Record<string, unknown> {
  branch: CanvasBranch;
  draft: CanvasDraft;
  label: string;
  onTextChange: (value: string) => void;
  onFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
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

function InteractionNode({ data }: NodeProps<InteractionFlowNode>) {
  const { language } = useSettings();
  const copy = getCanvasCopy(language);
  const { interaction, preview, composerOpen, canAdd, onAdd } = data;
  const visibleOutput = interaction.agentOutput || preview;
  const running = interaction.executionState === 'running';
  const bootstrapWarnings = Array.isArray(interaction.sessionMetadata.bootstrapWarnings)
    ? interaction.sessionMetadata.bootstrapWarnings.filter((item): item is string => typeof item === 'string')
    : [];
  return (
    <article className="w-[380px] rounded-3xl border border-border/80 bg-card/96 p-4 shadow-2xl backdrop-blur">
      <Handle type="target" position={Position.Left} className="!bg-primary" />
      <header className="canvas-node-drag-handle flex cursor-grab items-center justify-between gap-3 active:cursor-grabbing">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-2 rounded-full ${running ? 'animate-pulse bg-primary' : interaction.executionState === 'failed' || interaction.executionState === 'unconfirmed' ? 'bg-destructive' : 'bg-green'}`} />
          <span translate="no" className="notranslate truncate text-[0.667rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {interactionStatusLabel(interaction, copy)}
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
        {running && !visibleOutput ? (
          <div translate="no" className="notranslate flex items-center gap-2 py-4 text-muted-foreground"><Loader2 size={15} className="animate-spin" /> {copy.waitingForResponse}</div>
        ) : visibleOutput ? (
          <MarkdownRenderer content={visibleOutput} />
        ) : (
          <p translate="no" className="notranslate py-3 text-muted-foreground">{copy.noResponse}</p>
        )}
      </div>

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
        onFocus={data.onFocus}
        onBlur={data.onBlur}
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
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={data.draft.sending || data.draft.files.length >= MAX_CANVAS_ATTACHMENTS}>
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

export const canvasNodeTypes = {
  interaction: InteractionNode,
  composer: ComposerNode,
};

export function autoLayoutCanvasNodes(nodes: CanvasFlowNode[], edges: Edge[]): CanvasFlowNode[] {
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

export function canvasNodeBounds(node: CanvasFlowNode, rendered?: CanvasFlowNode): CanvasNodeBounds {
  const fallbackWidth = node.type === 'composer' ? COMPOSER_NODE_WIDTH : INTERACTION_NODE_WIDTH;
  return {
    id: node.id,
    position: node.position,
    width: rendered?.measured?.width || node.measured?.width || fallbackWidth,
    height: rendered?.measured?.height || node.measured?.height || DEFAULT_NODE_HEIGHT,
  };
}
