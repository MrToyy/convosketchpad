import { Hono } from 'hono';
import { InvalidAgentIdError } from '../lib/agent-workspace.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import {
  importExternalUploadToCanonicalReference,
  resolveDirectWorkspaceReference,
} from '../lib/upload-reference.js';

const app = new Hono();

app.post('/api/upload-reference/resolve', rateLimitGeneral, async (c) => {
  try {
    const contentType = c.req.header('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await c.req.json().catch(() => null) as { path?: unknown; paths?: unknown; agentId?: unknown } | null;
      const paths = Array.isArray(body?.paths)
        ? body.paths.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : typeof body?.path === 'string' && body.path.trim().length > 0
          ? [body.path]
          : [];
      const agentId = typeof body?.agentId === 'string' && body.agentId.trim().length > 0
        ? body.agentId
        : undefined;

      if (paths.length === 0) {
        return c.json({ ok: false, error: 'At least one workspace path is required.' }, 400);
      }

      const items = await Promise.all(paths.map((targetPath) => resolveDirectWorkspaceReference(targetPath, agentId)));
      return c.json({ ok: true, items });
    }

    const form = await c.req.formData();
    const requestedAgentId = form.get('agentId');
    const agentId = typeof requestedAgentId === 'string' && requestedAgentId.trim() ? requestedAgentId.trim() : undefined;
    const purpose = form.get('purpose');
    const requestedCanvasId = form.get('canvasId');
    const canvasId = typeof requestedCanvasId === 'string' && /^[a-f0-9-]{36}$/i.test(requestedCanvasId)
      ? requestedCanvasId
      : undefined;
    const values = [...form.getAll('files'), ...form.getAll('file')];
    const files = values.filter((value): value is File => value instanceof File);

    if (files.length === 0) {
      return c.json({ ok: false, error: 'At least one file is required.' }, 400);
    }

    const items = await Promise.all(files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return importExternalUploadToCanonicalReference({
        originalName: file.name,
        mimeType: file.type,
        bytes,
        agentId,
        persistent: purpose === 'canvas',
        persistentNamespace: purpose === 'canvas' ? canvasId : undefined,
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
