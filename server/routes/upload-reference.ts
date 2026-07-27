import { Hono } from 'hono';
import { getCanvasIdentity } from '../lib/canvas-auth.js';
import { getCanvasStore } from '../lib/canvas-db.js';
import { persistCanvasAttachment } from '../lib/canvas-artifact-store.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();
const MAX_CANVAS_FILES = 4;
const MAX_CANVAS_FILE_BYTES = 20 * 1024 * 1024;

app.post('/api/canvas/canvases/:canvasId/attachments', rateLimitGeneral, async (c) => {
  try {
    const form = await c.req.formData();
    const canvasId = c.req.param('canvasId') || '';
    const values = [...form.getAll('files'), ...form.getAll('file')];
    const files = values.filter((value): value is File => value instanceof File);

    if (!/^[a-f0-9-]{36}$/i.test(canvasId)) return c.json({ ok: false, error: 'Valid Canvas upload metadata is required.' }, 400);
    if (files.length === 0 || files.length > MAX_CANVAS_FILES) return c.json({ ok: false, error: 'Canvas uploads require between one and four files.' }, 400);
    if (files.some((file) => file.size > MAX_CANVAS_FILE_BYTES)) return c.json({ ok: false, error: 'Canvas files must not exceed 20 MiB.' }, 413);

    const identity = getCanvasIdentity(c);
    if (!identity) return c.json({ ok: false, error: 'Authentication required' }, 401);
    const canvas = getCanvasStore().getCanvas(identity.userId, canvasId);
    if (!canvas) return c.json({ ok: false, error: 'Not found' }, 404);

    const items = await Promise.all(files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const attachment = await persistCanvasAttachment(identity.userId, canvasId, {
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        bytes,
      });
      return getCanvasStore().recordCanvasAttachment(identity.userId, canvasId, attachment);
    }));

    return c.json({ ok: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to persist Canvas attachment';
    return c.json({ ok: false, error: message }, 500);
  }
});

app.post('/api/canvas/attachments/:attachmentId/delivery-variant', rateLimitGeneral, async (c) => {
  try {
    const identity = getCanvasIdentity(c);
    if (!identity) return c.json({ ok: false, error: 'Authentication required' }, 401);
    const attachmentId = c.req.param('attachmentId') || '';
    const form = await c.req.formData();
    const canvasId = String(form.get('canvasId') || '');
    const file = form.get('file');
    if (!/^[a-f0-9]{40}$/.test(attachmentId) || !/^[a-f0-9-]{36}$/i.test(canvasId) || !(file instanceof File)) {
      return c.json({ ok: false, error: 'Valid delivery variant metadata is required.' }, 400);
    }
    const original = getCanvasStore().getOwnedCanvasAttachments(identity.userId, canvasId, [attachmentId])[0];
    if (!original) return c.json({ ok: false, error: 'Not found' }, 404);
    if (file.size > MAX_CANVAS_FILE_BYTES) return c.json({ ok: false, error: 'Delivery variant must not exceed 20 MiB.' }, 413);
    const delivery = await persistCanvasAttachment(identity.userId, canvasId, {
      name: original.name,
      mimeType: file.type || original.mimeType,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    if (!getCanvasStore().setCanvasAttachmentDeliveryVariant(
      identity.userId,
      canvasId,
      attachmentId,
      delivery,
    )) return c.json({ ok: false, error: 'Not found' }, 404);
    return c.json({ ok: true, item: delivery });
  } catch (error) {
    return c.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to persist delivery variant',
    }, 500);
  }
});

export default app;
