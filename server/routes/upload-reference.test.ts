/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const canvasId = 'b75708e4-a6a8-4768-98db-8fcbe84afc20';
const tempDirs = new Set<string>();

async function buildApp(canvas: { id: string; agentId: string } | null = { id: canvasId, agentId: 'main' }) {
  vi.resetModules();
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-upload-route-'));
  tempDirs.add(homeDir);
  const workspaceRoot = path.join(homeDir, '.openclaw', 'workspace');
  await fs.mkdir(workspaceRoot, { recursive: true });
  process.env.HOME = homeDir;
  delete process.env.CONVOSKETCHPAD_UPLOAD_STAGING_TEMP_DIR;
  vi.doMock('../lib/canvas-auth.js', () => ({ getCanvasIdentity: () => ({ userId: 'owner-a', name: 'Owner A' }) }));
  vi.doMock('../lib/canvas-db.js', () => ({ getCanvasStore: () => ({ getCanvas: () => canvas }) }));
  const route = await import('./upload-reference.js');
  return { app: route.default, workspaceRoot };
}

function canvasForm(agentId = 'main', files: File[] = [new File(['canvas upload'], 'source.txt', { type: 'text/plain' })]): FormData {
  const form = new FormData();
  form.append('agentId', agentId);
  form.append('purpose', 'canvas');
  form.append('canvasId', canvasId);
  files.forEach((file) => form.append('files', file));
  return form;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true });
    tempDirs.delete(dir);
  }
});

describe('POST /api/upload-reference/resolve', () => {
  it('stages an owner-scoped Canvas upload in the selected Agent workspace', async () => {
    const { app, workspaceRoot } = await buildApp();
    const response = await app.request('/api/upload-reference/resolve', { method: 'POST', body: canvasForm() });

    expect(response.status).toBe(200);
    const json = await response.json() as { items: Array<{ absolutePath: string; canonicalPath: string }> };
    expect(json.items[0].canonicalPath).toMatch(new RegExp(`^\\.convosketchpad/canvas-uploads/${canvasId}/`));
    expect(json.items[0].absolutePath).toBe(path.join(workspaceRoot, json.items[0].canonicalPath));
    await expect(fs.readFile(json.items[0].absolutePath, 'utf8')).resolves.toBe('canvas upload');
  });

  it('rejects stale Agent metadata before writing the upload', async () => {
    const { app } = await buildApp();
    const response = await app.request('/api/upload-reference/resolve', { method: 'POST', body: canvasForm('research') });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'agent_changed' });
  });

  it('does not expose uploads for an unknown or unowned Canvas', async () => {
    const { app } = await buildApp(null);
    const response = await app.request('/api/upload-reference/resolve', { method: 'POST', body: canvasForm() });
    expect(response.status).toBe(404);
  });

  it('requires Canvas metadata and enforces the four-file limit', async () => {
    const { app } = await buildApp();
    const missing = await app.request('/api/upload-reference/resolve', { method: 'POST', body: new FormData() });
    expect(missing.status).toBe(400);

    const files = Array.from({ length: 5 }, (_, index) => new File(['x'], `${index}.txt`));
    const excessive = await app.request('/api/upload-reference/resolve', { method: 'POST', body: canvasForm('main', files) });
    expect(excessive.status).toBe(400);
  });
});
