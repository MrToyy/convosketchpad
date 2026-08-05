import { PanelLeftClose, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CanvasCopy } from './messages';
import type { CanvasSummary } from './types';

interface CanvasSidebarProps {
  canvases: CanvasSummary[];
  selectedId: string | null;
  language: string;
  copy: CanvasCopy;
  editingCanvasId: string | null;
  editingCanvasName: string;
  onEditingCanvasNameChange(value: string): void;
  onEditingCanvasIdChange(id: string | null): void;
  onSelect(id: string): void;
  onRename(canvas: CanvasSummary): void;
  onDelete(canvas: CanvasSummary): void;
  onCreate(): void;
  onHide(): void;
}

export function CanvasSidebar({
  canvases,
  selectedId,
  language,
  copy,
  editingCanvasId,
  editingCanvasName,
  onEditingCanvasNameChange,
  onEditingCanvasIdChange,
  onSelect,
  onRename,
  onDelete,
  onCreate,
  onHide,
}: CanvasSidebarProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border/75 bg-card/65 p-3">
      <div className="flex items-center justify-between gap-2 px-1 py-2">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{copy.canvasList}</div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={onHide} title={copy.hideCanvasList} aria-label={copy.hideCanvasList}><PanelLeftClose size={15} /></Button>
          <Button size="icon" variant="outline" onClick={onCreate} title={copy.newCanvas}><Plus size={15} /></Button>
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
                  onChange={(event) => onEditingCanvasNameChange(event.target.value)}
                  onBlur={() => onRename(canvas)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') onEditingCanvasIdChange(null);
                  }}
                  maxLength={120}
                  aria-label={copy.renameCanvas(canvas.name)}
                  className="w-full rounded-lg border border-primary/45 bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
                />
                <div className="mt-1 px-1 text-[0.667rem] text-muted-foreground">{copy.renameHint}</div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(canvas.id)}
                onDoubleClick={() => {
                  onEditingCanvasIdChange(canvas.id);
                  onEditingCanvasNameChange(canvas.name);
                }}
                className="min-w-0 flex-1 rounded-xl px-3 py-2 text-left"
              >
                <div className="truncate text-sm font-medium">{canvas.name}</div>
                <div className="mt-1 text-[0.667rem] text-muted-foreground">{new Date(canvas.updatedAt).toLocaleDateString(language)}</div>
              </button>
            )}
            {editingCanvasId !== canvas.id && (
              <button
                type="button"
                onClick={() => {
                  onEditingCanvasIdChange(canvas.id);
                  onEditingCanvasNameChange(canvas.name);
                }}
                className="p-2 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                aria-label={copy.renameCanvas(canvas.name)}
                title={copy.renameCanvas(canvas.name)}
              ><Pencil size={14} /></button>
            )}
            <button type="button" onClick={() => onDelete(canvas)} className="p-2 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100" aria-label={copy.deleteCanvas(canvas.name)} title={copy.deleteCanvas(canvas.name)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </aside>
  );
}
