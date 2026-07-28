import { useState, useCallback } from 'react';
import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/dialog';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useSettings } from '@/contexts/SettingsContext';
import { getAppCopy } from '@/lib/app-messages';

interface ImageLightboxProps {
  thumbnailSrc: string;
  originalSrc: string;
  alt?: string;
  thumbnailClassName?: string;
}

/** Thumbnail that expands into a full-screen lightbox on click. */
export function ImageLightbox({
  thumbnailSrc,
  originalSrc,
  alt,
  thumbnailClassName,
}: ImageLightboxProps) {
  const { language } = useSettings();
  const copy = getAppCopy(language);
  const imageAlt = alt || copy.media.image;
  const [open, setOpen] = useState(false);

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(originalSrc);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const rawName = originalSrc.split('/').pop()?.split('?')[0];
      const filename = rawName || `image-${Date.now()}.png`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: open in new tab
      window.open(originalSrc, '_blank');
    }
  }, [originalSrc]);

  const handleOpenOriginal = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(originalSrc, '_blank');
  }, [originalSrc]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <img
          src={thumbnailSrc}
          alt={imageAlt}
          className={thumbnailClassName || "max-w-[512px] max-h-[512px] rounded border border-border/60 object-contain cursor-pointer hover:border-primary/60 transition-colors"}
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      </DialogPrimitive.Trigger>
      <DialogPortal>
        <DialogOverlay className="bg-black/80 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none"
          onClick={() => setOpen(false)}
        >
          <DialogPrimitive.Title className="sr-only">{imageAlt}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{copy.media.expandedView(imageAlt)}</DialogPrimitive.Description>
          {open && (
            <img
              src={originalSrc}
              alt={imageAlt}
              className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          {/* Top-right action buttons */}
          <div className="absolute top-4 right-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              className="text-white/70 hover:text-white text-xs font-mono cursor-pointer bg-black/50 hover:bg-black/70 backdrop-blur-sm rounded-md px-3 py-2 flex items-center gap-1.5 transition-colors border border-white/10"
              onClick={handleDownload}
              aria-label={copy.media.downloadImage}
              title={copy.media.download}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {copy.media.save}
            </button>
            <button
              className="text-white/70 hover:text-white text-xs font-mono cursor-pointer bg-black/50 hover:bg-black/70 backdrop-blur-sm rounded-md px-3 py-2 flex items-center gap-1.5 transition-colors border border-white/10"
              onClick={handleOpenOriginal}
              aria-label={copy.media.openOriginal}
              title={copy.media.openNewTab}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              {copy.media.open}
            </button>
            <button
              className="text-white/70 hover:text-white text-2xl font-mono cursor-pointer bg-black/50 hover:bg-black/70 backdrop-blur-sm rounded-full w-9 h-9 flex items-center justify-center transition-colors border border-white/10"
              onClick={() => setOpen(false)}
              aria-label={copy.common.close}
            >
              ×
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
