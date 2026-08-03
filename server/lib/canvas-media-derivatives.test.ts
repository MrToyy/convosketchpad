import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

let tempRoot = '';
let artifactsRoot = '';

async function setup() {
  vi.resetModules();
  vi.doMock('./config.js', () => ({
    config: {
      canvasDatabasePath: path.join(tempRoot, 'canvas.sqlite'),
      canvasArtifactsPath: artifactsRoot,
      gatewayUrl: 'ws://127.0.0.1:18789',
      gatewayToken: 'test-token',
    },
  }));
  vi.doMock('./gateway-rpc.js', () => ({
    gatewaySupports: () => false,
    gatewayRpcCall: async () => ({}),
    getGatewaySharedHttpAuthToken: () => 'test-token',
  }));
  const db = await import('./canvas-db.js');
  const files = await import('./canvas-artifact-store.js');
  const media = await import('./canvas-media-derivatives.js');
  const store = new db.CanvasStore(path.join(tempRoot, 'canvas.sqlite'));
  store.ensureUser('owner-a', 'Owner A');
  const canvas = store.createCanvas('owner-a', 'Media', { runtimeId: 'openclaw', profileId: 'main' });
  return { store, canvas, files, media };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-media-derivatives-'));
  artifactsRoot = path.join(tempRoot, 'artifacts');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('Canvas media derivatives', () => {
  it('creates and reuses a bounded thumbnail without modifying the original', async () => {
    const current = await setup();
    const original = await sharp({
      create: {
        width: 1800,
        height: 1200,
        channels: 4,
        background: { r: 38, g: 90, b: 140, alpha: 0.7 },
      },
    }).png().toBuffer();
    const attachment = await current.files.persistCanvasAttachment('owner-a', current.canvas.id, {
      name: 'source.png',
      mimeType: 'image/png',
      bytes: original,
    });
    current.store.recordCanvasAttachment('owner-a', current.canvas.id, attachment);
    const source = {
      ownerId: 'owner-a',
      canvasId: current.canvas.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      contentHash: attachment.contentHash,
      loadBytes: () => current.files.readCanvasAttachment('owner-a', current.canvas.id, attachment.id),
    };

    const first = await current.media.ensureCanvasMediaDerivative(current.store, source, 'thumbnail');
    const second = await current.media.ensureCanvasMediaDerivative(current.store, source, 'thumbnail');
    const metadata = await sharp(first.bytes).metadata();

    expect(first.derivative.mimeType).toBe('image/webp');
    expect(first.bytes.byteLength).toBeLessThanOrEqual(160 * 1024);
    expect(Math.max(metadata.width || 0, metadata.height || 0)).toBeLessThanOrEqual(768);
    expect(second.derivative.derivativeId).toBe(first.derivative.derivativeId);
    expect(Buffer.from(await current.files.readCanvasAttachment(
      'owner-a',
      current.canvas.id,
      attachment.id,
    ) || []).equals(original)).toBe(true);
    current.store.close();
  });

  it('creates a bounded delivery image and rejects SVG input', async () => {
    const current = await setup();
    const original = await sharp({
      create: {
        width: 2400,
        height: 1600,
        channels: 3,
        background: { r: 120, g: 40, b: 80 },
      },
    }).png().toBuffer();
    const prepared = await current.media.ensureCanvasMediaDerivative(current.store, {
      ownerId: 'owner-a',
      canvasId: current.canvas.id,
      name: 'large.png',
      mimeType: 'image/png',
      loadBytes: async () => original,
    }, 'delivery');

    expect(prepared.bytes.byteLength).toBeLessThanOrEqual(current.media.CANVAS_DELIVERY_MAX_BYTES);
    await expect(current.media.ensureCanvasMediaDerivative(current.store, {
      ownerId: 'owner-a',
      canvasId: current.canvas.id,
      name: 'vector.svg',
      mimeType: 'image/svg+xml',
      loadBytes: async () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    }, 'thumbnail')).rejects.toThrow('unsupported_image_format');
    current.store.close();
  });

  it('backfills historical image hashes and thumbnails exactly once', async () => {
    const current = await setup();
    const original = await sharp({
      create: {
        width: 900,
        height: 600,
        channels: 3,
        background: { r: 20, g: 160, b: 80 },
      },
    }).jpeg().toBuffer();
    const persisted = await current.files.persistCanvasAttachment('owner-a', current.canvas.id, {
      name: 'history.jpg',
      mimeType: 'image/jpeg',
      bytes: original,
    });
    current.store.recordCanvasAttachment('owner-a', current.canvas.id, {
      ...persisted,
      contentHash: undefined,
    });
    const text = await current.files.persistCanvasAttachment('owner-a', current.canvas.id, {
      name: 'notes.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from('historical context'),
    });
    current.store.recordCanvasAttachment('owner-a', current.canvas.id, {
      ...text,
      contentHash: undefined,
    });

    const result = await current.media.runCanvasMediaBackfillMigration(current.store);

    expect(result).toMatchObject({ total: 2, hashed: 2, generated: 1, skipped: 0 });
    expect(current.media.canvasMediaBackfillApplied(current.store)).toBe(true);
    expect(current.store.getOwnedCanvasAttachment(
      'owner-a',
      current.canvas.id,
      persisted.id,
    )?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(current.store.getOwnedCanvasAttachment(
      'owner-a',
      current.canvas.id,
      text.id,
    )?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await current.media.runCanvasMediaBackfillMigration(current.store)).toBeNull();
    current.store.close();
  });

  it('does not record a systemically failed backfill and retries it successfully', async () => {
    const current = await setup();
    const persisted = await current.files.persistCanvasAttachment('owner-a', current.canvas.id, {
      name: 'retry.png',
      mimeType: 'image/png',
      bytes: await sharp({
        create: {
          width: 320,
          height: 240,
          channels: 3,
          background: { r: 180, g: 90, b: 20 },
        },
      }).png().toBuffer(),
    });
    current.store.recordCanvasAttachment('owner-a', current.canvas.id, {
      ...persisted,
      contentHash: undefined,
    });
    const failHashWrite = vi.spyOn(current.store, 'setCanvasAttachmentContentHash')
      .mockImplementation(() => {
        throw Object.assign(new Error('storage full'), { code: 'ENOSPC' });
      });

    await expect(current.media.runCanvasMediaBackfillMigration(current.store))
      .rejects.toThrow('storage full');
    expect(current.media.canvasMediaBackfillApplied(current.store)).toBe(false);

    failHashWrite.mockRestore();
    await expect(current.media.runCanvasMediaBackfillMigration(current.store))
      .resolves.toMatchObject({ total: 1, hashed: 1, generated: 1, skipped: 0 });
    expect(current.media.canvasMediaBackfillApplied(current.store)).toBe(true);
    current.store.close();
  });
});
