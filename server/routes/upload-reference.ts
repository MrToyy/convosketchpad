import { Hono } from 'hono';
import { InvalidAgentIdError } from '../lib/agent-workspace.js';
import { getCanvasIdentity } from '../lib/canvas-auth.js';
import { getCanvasStore } from '../lib/canvas-db.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { importExternalUploadToCanonicalReference } from '../lib/upload-reference.js';

const app = new Hono();
const MAX_CANVAS_FILES = 4;
const MAX_CANVAS_FILE_BYTES = 20 * 1024 * 1024;

app.post('/api/upload-reference/resolve', rateLimitGeneral, async (c) => {
  try {
    const form = await c.req.formData();
    const requestedAgentId = form.get('agentId');
    const agentId = typeof requestedAgentId === 'string' ? requestedAgentId.trim() : '';
    const purpose = form.get('purpose');
    const requestedCanvasId = form.get('canvasId');
    const canvasId = typeof requestedCanvasId === 'string' && /^[a-f0-9-]{36}$/i.test(requestedCanvasId)
      ? requestedCanvasId
      : undefined;
    const values = [...form.getAll('files'), ...form.getAll('file')];
    const files = values.filter((value): value is File => value instanceof File);

    if (purpose !== 'canvas' || !canvasId || !agentId) return c.json({ ok: false, error: 'Valid Canvas upload metadata is required.' }, 400);
    if (files.length === 0 || files.length > MAX_CANVAS_FILES) return c.json({ ok: false, error: 'Canvas uploads require between one and four files.' }, 400);
    if (files.some((file) => file.size > MAX_CANVAS_FILE_BYTES)) return c.json({ ok: false, error: 'Canvas files must not exceed 20 MiB.' }, 413);

    const identity = getCanvasIdentity(c);
    if (!identity) return c.json({ ok: false, error: 'Authentication required' }, 401);
    const canvas = getCanvasStore().getCanvas(identity.userId, canvasId);
    if (!canvas) return c.json({ ok: false, error: 'Not found' }, 404);
    if (canvas.agentId !== agentId) return c.json({ ok: false, error: 'agent_changed' }, 409);

    const items = await Promise.all(files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return importExternalUploadToCanonicalReference({
        originalName: file.name,
        mimeType: file.type,
        bytes,
        agentId,
        persistent: true,
        persistentNamespace: canvasId,
      });
    }));

    return c.json({ ok: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve canonical upload reference';
    const status = error instanceof InvalidAgentIdError
      ? 400
      : message === 'Invalid or excluded workspace path.' || message === 'Resolved attachment path is outside the workspace root.'
        ? 403
        : message === 'Resolved attachment path is not a file.'
          ? 400
          : 500;
    return c.json({ ok: false, error: message }, status);
  }
});

export default app;
