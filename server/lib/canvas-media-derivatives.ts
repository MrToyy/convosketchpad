import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  persistCanvasMediaDerivative,
  readCanvasArtifact,
  readCanvasAttachment,
  readCanvasMediaDerivative,
} from './canvas-artifact-store.js';
import type {
  CanvasMediaDerivative,
  CanvasMediaDerivativePurpose,
  CanvasStore,
} from './canvas-db.js';
import { CANVAS_MEDIA_BACKFILL_MIGRATION } from './canvas-migration-plan.js';
import { packageMetadata } from './package-metadata.js';

export const CANVAS_DELIVERY_POLICY_VERSION = 'delivery-v1';
export const CANVAS_THUMBNAIL_POLICY_VERSION = 'thumbnail-v1';
export const CANVAS_DELIVERY_MAX_BYTES = 1_800_000;
const CANVAS_DELIVERY_TARGET_BYTES = 1_650_000;
const CANVAS_THUMBNAIL_MAX_BYTES = 160 * 1024;
const MAX_INPUT_PIXELS = 80_000_000;
const IMAGE_TIMEOUT_SECONDS = 15;
const SUPPORTED_RASTER_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff', 'heif']);

sharp.concurrency(1);

export interface CanvasMediaSource {
  ownerId: string;
  canvasId: string;
  name: string;
  mimeType: string;
  contentHash?: string;
  loadBytes: () => Promise<Uint8Array | null>;
  recordContentHash?: (contentHash: string) => void;
}

export interface CanvasPreparedDerivative {
  derivative: CanvasMediaDerivative;
  bytes: Uint8Array;
}

export interface CanvasMediaBackfillResult {
  total: number;
  hashed: number;
  generated: number;
  reused: number;
  skipped: number;
  warnings: string[];
}

export function isCanvasMediaSystemError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : String(error);
  return code.startsWith('SQLITE_')
    || ['EACCES', 'ENOSPC', 'EROFS', 'EIO', 'EMFILE', 'ENFILE'].includes(code)
    || /database is locked|database disk image is malformed|readonly database/i.test(message);
}

interface EncodedDerivative {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
}

type QueuePriority = 'delivery' | 'thumbnail';

const queue: Record<QueuePriority, Array<() => void>> = {
  delivery: [],
  thumbnail: [],
};
const inFlight = new Map<string, Promise<CanvasPreparedDerivative>>();
let active = 0;
const MAX_CONCURRENT_DERIVATIVES = 2;

function schedule<T>(priority: QueuePriority, task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      active += 1;
      void task().then(resolve, reject).finally(() => {
        active -= 1;
        drain();
      });
    };
    queue[priority].push(start);
    drain();
  });
}

function drain(): void {
  while (active < MAX_CONCURRENT_DERIVATIVES) {
    const next = queue.delivery.shift() || queue.thumbnail.shift();
    if (!next) return;
    next();
  }
}

export function canvasMediaContentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canvasMediaPolicyVersion(purpose: CanvasMediaDerivativePurpose): string {
  return purpose === 'delivery'
    ? CANVAS_DELIVERY_POLICY_VERSION
    : CANVAS_THUMBNAIL_POLICY_VERSION;
}

export function canvasAttachmentThumbnailUri(canvasId: string, attachmentId: string): string {
  return `/api/canvas/attachments/${encodeURIComponent(canvasId)}/${encodeURIComponent(attachmentId)}/thumbnail?v=${CANVAS_THUMBNAIL_POLICY_VERSION}`;
}

export function canvasArtifactThumbnailUri(
  canvasId: string,
  interactionId: string,
  artifactId: string,
): string {
  return `/api/canvas/artifacts/${encodeURIComponent(canvasId)}/${encodeURIComponent(interactionId)}/${encodeURIComponent(artifactId)}/thumbnail?v=${CANVAS_THUMBNAIL_POLICY_VERSION}`;
}

function dimensionRungs(start: number, minimum: number): number[] {
  const result = [Math.max(minimum, Math.round(start))];
  while (result[result.length - 1] > minimum) {
    const next = Math.max(minimum, Math.round(result[result.length - 1] * 0.85));
    if (next === result[result.length - 1]) break;
    result.push(next);
  }
  return result;
}

async function imageMetadata(bytes: Uint8Array, mimeType: string) {
  if (mimeType.toLowerCase().includes('svg')) throw new Error('unsupported_image_format');
  const metadata = await sharp(bytes, {
    failOn: 'error',
    limitInputPixels: MAX_INPUT_PIXELS,
    animated: false,
  }).timeout({ seconds: IMAGE_TIMEOUT_SECONDS }).metadata();
  if (!metadata.format || !SUPPORTED_RASTER_FORMATS.has(metadata.format)) {
    throw new Error('unsupported_image_format');
  }
  if (!metadata.width || !metadata.height) throw new Error('invalid_image_dimensions');
  return metadata;
}

async function encodeCandidate(
  bytes: Uint8Array,
  dimension: number,
  output: 'png' | 'webp',
  quality: number,
): Promise<EncodedDerivative> {
  let pipeline = sharp(bytes, {
    failOn: 'error',
    limitInputPixels: MAX_INPUT_PIXELS,
    animated: false,
  })
    .timeout({ seconds: IMAGE_TIMEOUT_SECONDS })
    .rotate()
    .resize({
      width: dimension,
      height: dimension,
      fit: 'inside',
      withoutEnlargement: true,
    });
  pipeline = output === 'png'
    ? pipeline.png({ compressionLevel: 9 })
    : pipeline.webp({ quality, alphaQuality: quality, effort: 4 });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    bytes: data,
    mimeType: output === 'png' ? 'image/png' : 'image/webp',
    width: info.width,
    height: info.height,
  };
}

async function createThumbnail(bytes: Uint8Array, mimeType: string): Promise<EncodedDerivative> {
  await imageMetadata(bytes, mimeType);
  let smallest: EncodedDerivative | null = null;
  for (const dimension of [768, 640, 512, 384, 256]) {
    for (const quality of [72, 64, 56]) {
      const candidate = await encodeCandidate(bytes, dimension, 'webp', quality);
      if (!smallest || candidate.bytes.byteLength < smallest.bytes.byteLength) smallest = candidate;
      if (candidate.bytes.byteLength <= CANVAS_THUMBNAIL_MAX_BYTES) return candidate;
    }
  }
  if (smallest && smallest.bytes.byteLength <= CANVAS_THUMBNAIL_MAX_BYTES) return smallest;
  throw new Error('thumbnail_too_large');
}

async function createDelivery(bytes: Uint8Array, mimeType: string): Promise<EncodedDerivative> {
  const metadata = await imageMetadata(bytes, mimeType);
  const output = metadata.hasAlpha ? 'png' : 'webp';
  const start = Math.min(2048, Math.max(metadata.width || 1, metadata.height || 1));
  let firstAcceptable: EncodedDerivative | null = null;
  let smallest: EncodedDerivative | null = null;
  for (const dimension of dimensionRungs(start, Math.min(384, start))) {
    const qualities = output === 'png' ? [100] : [82, 74, 66];
    for (const quality of qualities) {
      const candidate = await encodeCandidate(bytes, dimension, output, quality);
      if (!smallest || candidate.bytes.byteLength < smallest.bytes.byteLength) smallest = candidate;
      if (candidate.bytes.byteLength <= CANVAS_DELIVERY_MAX_BYTES && !firstAcceptable) {
        firstAcceptable = candidate;
      }
      if (candidate.bytes.byteLength <= CANVAS_DELIVERY_TARGET_BYTES) return candidate;
    }
  }
  if (smallest && smallest.bytes.byteLength <= CANVAS_DELIVERY_MAX_BYTES) return smallest;
  throw new Error('image_delivery_too_large');
}

async function generateDerivative(
  store: CanvasStore,
  source: CanvasMediaSource,
  purpose: CanvasMediaDerivativePurpose,
  contentHash: string,
  originalBytes: Uint8Array,
): Promise<CanvasPreparedDerivative> {
  const encoded = purpose === 'delivery'
    ? await createDelivery(originalBytes, source.mimeType)
    : await createThumbnail(originalBytes, source.mimeType);
  const derivativeId = await persistCanvasMediaDerivative(
    source.ownerId,
    source.canvasId,
    encoded.bytes,
  );
  const derivative = store.recordCanvasMediaDerivative({
    canvasId: source.canvasId,
    sourceContentHash: contentHash,
    purpose,
    policyVersion: canvasMediaPolicyVersion(purpose),
    derivativeId,
    mimeType: encoded.mimeType,
    sizeBytes: encoded.bytes.byteLength,
    width: encoded.width,
    height: encoded.height,
  });
  return { derivative, bytes: encoded.bytes };
}

export async function ensureCanvasMediaDerivative(
  store: CanvasStore,
  source: CanvasMediaSource,
  purpose: CanvasMediaDerivativePurpose,
): Promise<CanvasPreparedDerivative> {
  const policyVersion = canvasMediaPolicyVersion(purpose);
  let originalBytes: Uint8Array | null = null;
  let contentHash = source.contentHash;
  if (contentHash) {
    const cached = store.getCanvasMediaDerivative(source.canvasId, contentHash, purpose, policyVersion);
    if (cached) {
      const bytes = await readCanvasMediaDerivative(source.ownerId, source.canvasId, cached.derivativeId);
      if (bytes) return { derivative: cached, bytes };
    }
  } else {
    originalBytes = await source.loadBytes();
    if (!originalBytes) throw new Error('media_source_unavailable');
    contentHash = canvasMediaContentHash(originalBytes);
    source.recordContentHash?.(contentHash);
  }

  const key = `${source.canvasId}:${contentHash}:${purpose}:${policyVersion}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = schedule(purpose, async () => {
    const cached = store.getCanvasMediaDerivative(source.canvasId, contentHash!, purpose, policyVersion);
    if (cached) {
      const bytes = await readCanvasMediaDerivative(source.ownerId, source.canvasId, cached.derivativeId);
      if (bytes) return { derivative: cached, bytes };
    }
    const bytes = originalBytes || await source.loadBytes();
    if (!bytes) throw new Error('media_source_unavailable');
    return generateDerivative(store, source, purpose, contentHash!, bytes);
  }).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

export async function backfillCanvasThumbnails(store: CanvasStore): Promise<CanvasMediaBackfillResult> {
  const sources = store.listCanvasMediaBackfillSources();
  const result: CanvasMediaBackfillResult = {
    total: sources.length,
    hashed: 0,
    generated: 0,
    reused: 0,
    skipped: 0,
    warnings: [],
  };
  let cursor = 0;
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT_DERIVATIVES, Math.max(1, sources.length)) }, async () => {
    while (cursor < sources.length) {
      const source = sources[cursor++];
      try {
        let loadedBytes: Uint8Array | null = null;
        const loadBytes = async () => {
          if (loadedBytes) return loadedBytes;
          if (source.kind === 'attachment') {
            loadedBytes = await readCanvasAttachment(source.ownerId, source.canvasId, source.sourceId);
            return loadedBytes;
          }
          if (!source.interactionId) return null;
          const interaction = store.getOwnedInteraction(source.ownerId, source.interactionId);
          loadedBytes = interaction
            ? (await readCanvasArtifact(interaction, source.sourceId))?.bytes || null
            : null;
          return loadedBytes;
        };
        let contentHash = source.contentHash;
        if (!contentHash) {
          const bytes = await loadBytes();
          if (!bytes) throw new Error('media_source_unavailable');
          contentHash = canvasMediaContentHash(bytes);
          if (source.kind === 'attachment') {
            store.setCanvasAttachmentContentHash(
              source.ownerId,
              source.canvasId,
              source.sourceId,
              contentHash,
            );
          } else if (source.interactionId) {
            store.setInteractionArtifactContentHash(
              source.ownerId,
              source.interactionId,
              source.sourceId,
              contentHash,
            );
          }
          result.hashed += 1;
        }
        if (!source.mimeType.toLowerCase().startsWith('image/')) continue;
        const existing = store.getCanvasMediaDerivative(
          source.canvasId,
          contentHash,
          'thumbnail',
          CANVAS_THUMBNAIL_POLICY_VERSION,
        );
        await ensureCanvasMediaDerivative(store, {
          ownerId: source.ownerId,
          canvasId: source.canvasId,
          name: source.name,
          mimeType: source.mimeType,
          contentHash,
          loadBytes,
        }, 'thumbnail');
        if (existing) result.reused += 1;
        else result.generated += 1;
      } catch (error) {
        if (isCanvasMediaSystemError(error)) throw error;
        result.skipped += 1;
        result.warnings.push(
          `${source.kind}:${source.sourceId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  });
  await Promise.all(workers);
  return result;
}

export function canvasMediaBackfillApplied(store: CanvasStore): boolean {
  return Boolean(store.db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?')
    .get(CANVAS_MEDIA_BACKFILL_MIGRATION));
}

export async function runCanvasMediaBackfillMigration(
  store: CanvasStore,
  options: { scanWhenApplied?: boolean } = {},
): Promise<CanvasMediaBackfillResult | null> {
  if (canvasMediaBackfillApplied(store) && !options.scanWhenApplied) return null;
  const result = await backfillCanvasThumbnails(store);
  store.db.prepare(`INSERT INTO schema_migrations(id, applied_at, app_version)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET applied_at = excluded.applied_at, app_version = excluded.app_version`)
    .run(CANVAS_MEDIA_BACKFILL_MIGRATION, Date.now(), packageMetadata.version);
  return result;
}
