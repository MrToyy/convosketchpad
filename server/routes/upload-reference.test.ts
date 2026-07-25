import { afterEach, describe, expect, it, vi } from 'vitest';

const canvasId = 'b75708e4-a6a8-4768-98db-8fcbe84afc20';
const persistCanvasAttachment = vi.fn();

async function buildApp(canvas: { id: string; agentId: string } | null = { id: canvasId, agentId: 'main' }) {
  vi.resetModules();
  persistCanvasAttachment.mockImplementation(async (_ownerId, currentCanvasId, input) => ({
    id: 'a'.repeat(40),
    name: input.name,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.byteLength,
    uri: `/api/canvas/attachments/${currentCanvasId}/${'a'.repeat(40)}`,
    storage: 'canvas',
    available: true,
  }));
  vi.doMock('../lib/canvas-auth.js', () => ({ getCanvasIdentity: () => ({ userId: 'owner-a', name: 'Owner A' }) }));
  vi.doMock('../lib/canvas-db.js', () => ({ getCanvasStore: () => ({ getCanvas: () => canvas }) }));
  vi.doMock('../lib/canvas-artifact-store.js', () => ({ persistCanvasAttachment }));
  const route = await import('./upload-reference.js');
  return { app: route.default };
}

function canvasForm(files: File[] = [new File(['canvas upload'], 'source.txt', { type: 'text/plain' })]): FormData {
  const form = new FormData();
  files.forEach((file) => form.append('files', file));
  return form;
}

afterEach(async () => {
  vi.restoreAllMocks();
  persistCanvasAttachment.mockReset();
});

describe('POST /api/canvas/canvases/:canvasId/attachments', () => {
  it('persists an owner-scoped upload without returning an OpenClaw path', async () => {
    const { app } = await buildApp();
    const response = await app.request(`/api/canvas/canvases/${canvasId}/attachments`, { method: 'POST', body: canvasForm() });

    expect(response.status).toBe(200);
    const json = await response.json() as { items: Array<Record<string, unknown>> };
    expect(json.items[0]).toEqual(expect.objectContaining({
      id: 'a'.repeat(40),
      storage: 'canvas',
      uri: `/api/canvas/attachments/${canvasId}/${'a'.repeat(40)}`,
    }));
    expect(json.items[0]).not.toHaveProperty('absolutePath');
    expect(json.items[0]).not.toHaveProperty('workspacePath');
    expect(persistCanvasAttachment).toHaveBeenCalledWith(
      'owner-a',
      canvasId,
      expect.objectContaining({ name: 'source.txt', mimeType: 'text/plain' }),
    );
  });

  it('does not expose uploads for an unknown or unowned Canvas', async () => {
    const { app } = await buildApp(null);
    const response = await app.request(`/api/canvas/canvases/${canvasId}/attachments`, { method: 'POST', body: canvasForm() });
    expect(response.status).toBe(404);
  });

  it('requires Canvas metadata and enforces the four-file limit', async () => {
    const { app } = await buildApp();
    const missing = await app.request(`/api/canvas/canvases/${canvasId}/attachments`, { method: 'POST', body: new FormData() });
    expect(missing.status).toBe(400);

    const files = Array.from({ length: 5 }, (_, index) => new File(['x'], `${index}.txt`));
    const excessive = await app.request(`/api/canvas/canvases/${canvasId}/attachments`, { method: 'POST', body: canvasForm(files) });
    expect(excessive.status).toBe(400);
  });
});
