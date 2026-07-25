import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import {
  gatewayRpcCall,
  gatewaySupports,
  getGatewayHttpAuthToken,
} from './gateway-rpc.js';
import type { CanvasArtifact, CanvasAttachment, OwnedInteractionRecord } from './canvas-db.js';

export const CANVAS_ARTIFACT_MAX_BYTES = 25 * 1024 * 1024;
const ARTIFACT_ID_PATTERN = /^[a-f0-9]{40}$/;

export interface MaterializedCanvasArtifacts {
  artifacts: CanvasArtifact[];
  complete: boolean;
  warnings: string[];
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function ownerDirectory(ownerId: string): string {
  return createHash('sha256').update(ownerId).digest('hex').slice(0, 32);
}

export function canvasArtifactId(sourceUri: string): string {
  return createHash('sha256').update(sourceUri).digest('hex').slice(0, 40);
}

export function canvasArtifactUri(canvasId: string, interactionId: string, artifactId: string): string {
  return `/api/canvas/artifacts/${encodeURIComponent(canvasId)}/${encodeURIComponent(interactionId)}/${encodeURIComponent(artifactId)}`;
}

export function canvasAttachmentUri(canvasId: string, attachmentId: string): string {
  return `/api/canvas/attachments/${encodeURIComponent(canvasId)}/${encodeURIComponent(attachmentId)}`;
}

function canvasDirectory(ownerId: string, canvasId: string): string {
  return path.join(config.canvasArtifactsPath, ownerDirectory(ownerId), canvasId);
}

function artifactFilePath(interaction: OwnedInteractionRecord, artifactId: string): string {
  if (!ARTIFACT_ID_PATTERN.test(artifactId)) throw new Error('Invalid Canvas Artifact ID');
  return path.join(canvasDirectory(interaction.ownerId, interaction.canvasId), interaction.id, artifactId);
}

function attachmentFilePath(ownerId: string, canvasId: string, attachmentId: string): string {
  if (!ARTIFACT_ID_PATTERN.test(attachmentId)) throw new Error('Invalid Canvas Attachment ID');
  return path.join(canvasDirectory(ownerId, canvasId), 'attachments', attachmentId);
}

export async function persistCanvasAttachment(
  ownerId: string,
  canvasId: string,
  input: { name: string; mimeType: string; bytes: Uint8Array },
): Promise<CanvasAttachment> {
  if (input.bytes.byteLength > CANVAS_ARTIFACT_MAX_BYTES) {
    throw new Error(`${input.name}: Attachment exceeds the 25 MiB persistence limit`);
  }
  const id = createHash('sha256').update(input.bytes).digest('hex').slice(0, 40);
  const target = attachmentFilePath(ownerId, canvasId, id);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const existing = await fs.stat(target).catch(() => null);
  if (!existing?.isFile()) {
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, input.bytes, { flag: 'wx' });
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }
  return {
    id,
    name: input.name,
    mimeType: input.mimeType || 'application/octet-stream',
    sizeBytes: input.bytes.byteLength,
    uri: canvasAttachmentUri(canvasId, id),
    storage: 'canvas',
    available: true,
  };
}

function artifactSourceUri(artifact: CanvasArtifact): string {
  return artifact.sourceUri || artifact.uri;
}

function externalUri(uri: string): boolean {
  return /^https?:\/\//i.test(uri);
}

function gatewayMediaUrl(uri: string): URL | null {
  if (!uri.startsWith('/api/chat/media/outgoing/')) return null;
  const gatewayHttpUrl = config.gatewayUrl
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:')
    .replace(/\/ws\/?$/, '');
  return new URL(uri, gatewayHttpUrl.endsWith('/') ? gatewayHttpUrl : `${gatewayHttpUrl}/`);
}

async function responseBytes(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > CANVAS_ARTIFACT_MAX_BYTES) throw new Error('Artifact exceeds the 25 MiB persistence limit');
  if (!response.body) throw new Error('Artifact response has no body');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > CANVAS_ARTIFACT_MAX_BYTES) {
      await reader.cancel();
      throw new Error('Artifact exceeds the 25 MiB persistence limit');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function nativeWorkspaceRoot(agentId: string): Promise<string | null> {
  if (!gatewaySupports('agents.list')) return null;
  const result = await gatewayRpcCall('agents.list', {}, 15_000).catch(() => null) as {
    agents?: Array<{ id?: unknown; workspace?: unknown }>;
  } | null;
  const workspace = result?.agents?.find((agent) => agent.id === agentId)?.workspace;
  return typeof workspace === 'string' && path.isAbsolute(workspace) ? path.resolve(workspace) : null;
}

function decodeWorkspaceContent(result: unknown): { bytes: Uint8Array; mimeType?: string } | null {
  const record = result && typeof result === 'object' ? result as Record<string, unknown> : null;
  const file = record?.file && typeof record.file === 'object'
    ? record.file as Record<string, unknown>
    : record;
  if (!file) return null;
  const content = typeof file.content === 'string'
    ? file.content
    : typeof file.data === 'string'
      ? file.data
      : null;
  if (content === null) return null;
  const encoding = typeof file.encoding === 'string' ? file.encoding.toLowerCase() : 'utf8';
  const bytes = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
  return {
    bytes,
    ...(typeof file.mimeType === 'string' ? { mimeType: file.mimeType } : {}),
  };
}

async function secureLocalPath(uri: string, agentId: string): Promise<string | null> {
  let candidate: string | null = null;
  try {
    if (uri.startsWith('file://')) candidate = fileURLToPath(uri);
    else if (path.isAbsolute(uri)) candidate = uri;
  } catch {
    return null;
  }
  if (!candidate) return null;

  const workspaceRoot = await nativeWorkspaceRoot(agentId);
  const allowedRoots = [
    ...(workspaceRoot ? [workspaceRoot] : []),
    path.resolve(os.tmpdir()),
  ];
  const resolved = path.resolve(candidate);
  if (!allowedRoots.some((root) => isWithin(resolved, root))) return null;
  const realPath = await fs.realpath(resolved).catch(() => null);
  if (!realPath) return null;
  const realAllowedRoots = await Promise.all(allowedRoots.map((root) => fs.realpath(root).catch(() => root)));
  if (!realAllowedRoots.some((root) => isWithin(realPath, root))) return null;
  const stat = await fs.stat(realPath).catch(() => null);
  if (!stat?.isFile()) return null;
  if (stat.size > CANVAS_ARTIFACT_MAX_BYTES) throw new Error('Artifact exceeds the 25 MiB persistence limit');
  return realPath;
}

async function loadSourceBytes(
  interaction: OwnedInteractionRecord,
  artifact: CanvasArtifact,
): Promise<{ bytes: Uint8Array; mimeType?: string }> {
  const uri = artifactSourceUri(artifact);
  const mediaUrl = gatewayMediaUrl(uri);
  if (mediaUrl) {
    const match = uri.match(/^\/api\/chat\/media\/outgoing\/([^/]+)\//);
    let sessionKey = '';
    try { sessionKey = match ? decodeURIComponent(match[1]) : ''; } catch { /* invalid encoding */ }
    if (sessionKey !== interaction.sessionKey) throw new Error('Artifact media session does not match the Interaction');
    const token = getGatewayHttpAuthToken();
    const response = await fetch(mediaUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`OpenClaw Artifact returned HTTP ${response.status}`);
    return {
      bytes: await responseBytes(response),
      mimeType: artifact.mimeType || response.headers.get('content-type') || undefined,
    };
  }

  if (uri.startsWith('data:')) {
    const match = uri.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/s);
    if (!match) throw new Error('Unsupported Artifact data URI');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.byteLength > CANVAS_ARTIFACT_MAX_BYTES) throw new Error('Artifact exceeds the 25 MiB persistence limit');
    return { bytes, mimeType: artifact.mimeType || match[1] };
  }

  if (!path.isAbsolute(uri) && !uri.startsWith('file:') && !/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
    if (!gatewaySupports('agents.workspace.get')) {
      throw new Error('Gateway does not provide agents.workspace.get for relative Artifact paths');
    }
    const result = await gatewayRpcCall('agents.workspace.get', {
      agentId: interaction.agentId,
      path: uri,
    }, 15_000);
    const decoded = decodeWorkspaceContent(result);
    if (!decoded) throw new Error('Gateway returned an unsupported workspace file payload');
    if (decoded.bytes.byteLength > CANVAS_ARTIFACT_MAX_BYTES) {
      throw new Error('Artifact exceeds the 25 MiB persistence limit');
    }
    return { bytes: decoded.bytes, mimeType: artifact.mimeType || decoded.mimeType };
  }

  const localPath = await secureLocalPath(uri, interaction.agentId);
  if (!localPath) throw new Error('Artifact source is not an allowed OpenClaw local file');
  return { bytes: await fs.readFile(localPath), mimeType: artifact.mimeType };
}

async function persistBytes(
  interaction: OwnedInteractionRecord,
  artifact: CanvasArtifact,
  sourceUri: string,
  bytes: Uint8Array,
  mimeType?: string,
): Promise<CanvasArtifact> {
  if (bytes.byteLength > CANVAS_ARTIFACT_MAX_BYTES) throw new Error('Artifact exceeds the 25 MiB persistence limit');
  const id = canvasArtifactId(sourceUri);
  const target = artifactFilePath(interaction, id);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const existing = await fs.stat(target).catch(() => null);
  if (!existing?.isFile()) {
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, bytes, { flag: 'wx' });
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }
  return {
    ...artifact,
    id,
    uri: canvasArtifactUri(interaction.canvasId, interaction.id, id),
    sourceUri,
    storage: 'canvas',
    available: true,
    sizeBytes: bytes.byteLength,
    ...(mimeType ? { mimeType } : {}),
    warning: undefined,
  };
}

export async function persistCanvasArtifactBytes(
  interaction: OwnedInteractionRecord,
  artifact: CanvasArtifact,
  sourceKey: string,
  bytes: Uint8Array,
  mimeType?: string,
): Promise<CanvasArtifact> {
  return persistBytes(interaction, artifact, sourceKey, bytes, mimeType);
}

async function persistedArtifactExists(interaction: OwnedInteractionRecord, artifact: CanvasArtifact): Promise<boolean> {
  if (artifact.storage !== 'canvas' || !artifact.id || !ARTIFACT_ID_PATTERN.test(artifact.id)) return false;
  return Boolean((await fs.stat(artifactFilePath(interaction, artifact.id)).catch(() => null))?.isFile());
}

export async function materializeCanvasArtifacts(
  interaction: OwnedInteractionRecord,
  extractedArtifacts: CanvasArtifact[],
): Promise<MaterializedCanvasArtifacts> {
  const existingBySource = new Map(interaction.artifacts.map((artifact) => [artifactSourceUri(artifact), artifact]));
  const artifacts: CanvasArtifact[] = [];
  const warnings: string[] = [];

  for (const extracted of extractedArtifacts) {
    const sourceUri = artifactSourceUri(extracted);
    const id = canvasArtifactId(sourceUri);
    if (externalUri(sourceUri)) {
      artifacts.push({ ...extracted, id, sourceUri, storage: 'external', available: true, warning: undefined });
      continue;
    }

    const existing = existingBySource.get(sourceUri);
    if (existing && await persistedArtifactExists(interaction, existing)) {
      artifacts.push({ ...existing, name: extracted.name, mimeType: extracted.mimeType || existing.mimeType });
      continue;
    }

    const stablePath = artifactFilePath(interaction, id);
    const stableFile = await fs.stat(stablePath).catch(() => null);
    if (stableFile?.isFile()) {
      artifacts.push({
        ...extracted,
        id,
        uri: canvasArtifactUri(interaction.canvasId, interaction.id, id),
        sourceUri,
        storage: 'canvas',
        available: true,
        sizeBytes: stableFile.size,
        warning: undefined,
      });
      continue;
    }

    try {
      const loaded = await loadSourceBytes(interaction, extracted);
      artifacts.push(await persistBytes(interaction, extracted, sourceUri, loaded.bytes, loaded.mimeType));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Artifact persistence failed';
      const warning = `${extracted.name}: ${message}`;
      warnings.push(warning);
      artifacts.push({
        ...extracted,
        id,
        sourceUri,
        storage: 'source',
        available: false,
        warning,
      });
    }
  }

  return { artifacts, complete: warnings.length === 0, warnings };
}

export async function validateCanvasAttachments(
  ownerId: string,
  canvasId: string,
  attachments: CanvasAttachment[],
): Promise<CanvasAttachment[]> {
  const persisted: CanvasAttachment[] = [];
  for (const attachment of attachments) {
    const id = attachment.id || '';
    if (!ARTIFACT_ID_PATTERN.test(id) || attachment.storage !== 'canvas') {
      throw new Error(`${attachment.name}: Attachment must reference Canvas-owned storage`);
    }
    const bytes = await readCanvasAttachment(ownerId, canvasId, id);
    if (!bytes) throw new Error(`${attachment.name}: Canvas attachment is unavailable`);
    const expectedUri = canvasAttachmentUri(canvasId, id);
    if (attachment.uri !== expectedUri || attachment.sizeBytes !== bytes.byteLength) {
      throw new Error(`${attachment.name}: Canvas attachment metadata does not match persisted content`);
    }
    persisted.push({
      id,
      name: attachment.name,
      mimeType: attachment.mimeType || 'application/octet-stream',
      sizeBytes: bytes.byteLength,
      uri: expectedUri,
      storage: 'canvas',
      available: true,
    });
  }
  return persisted;
}

export async function importCanvasArtifactFromFile(
  interaction: OwnedInteractionRecord,
  artifact: CanvasArtifact,
  sourceFile: string,
): Promise<CanvasArtifact> {
  const sourceUri = artifactSourceUri(artifact);
  const stat = await fs.stat(sourceFile);
  if (!stat.isFile()) throw new Error('Repair source is not a file');
  if (stat.size > CANVAS_ARTIFACT_MAX_BYTES) throw new Error('Artifact exceeds the 25 MiB persistence limit');
  return persistBytes(interaction, artifact, sourceUri, await fs.readFile(sourceFile), artifact.mimeType);
}

export async function readCanvasArtifact(
  interaction: OwnedInteractionRecord,
  artifactId: string,
): Promise<{ artifact: CanvasArtifact; bytes: Uint8Array } | null> {
  if (!ARTIFACT_ID_PATTERN.test(artifactId)) return null;
  const artifact = interaction.artifacts.find((candidate) => candidate.id === artifactId && candidate.storage === 'canvas');
  if (!artifact) return null;
  const bytes = await fs.readFile(artifactFilePath(interaction, artifactId)).catch(() => null);
  return bytes ? { artifact, bytes } : null;
}

export async function readCanvasAttachment(
  ownerId: string,
  canvasId: string,
  attachmentId: string,
): Promise<Uint8Array | null> {
  if (!ARTIFACT_ID_PATTERN.test(attachmentId)) return null;
  return fs.readFile(attachmentFilePath(ownerId, canvasId, attachmentId)).catch(() => null);
}

export async function deleteCanvasArtifacts(ownerId: string, canvasId: string): Promise<void> {
  await fs.rm(canvasDirectory(ownerId, canvasId), { recursive: true, force: true });
}

export async function cleanupOrphanCanvasArtifacts(canvasExists: (canvasId: string) => boolean): Promise<void> {
  const ownerDirs = await fs.readdir(config.canvasArtifactsPath, { withFileTypes: true }).catch(() => []);
  for (const ownerDir of ownerDirs) {
    if (!ownerDir.isDirectory() || ownerDir.name.startsWith('.')) continue;
    const ownerPath = path.join(config.canvasArtifactsPath, ownerDir.name);
    const canvasDirs = await fs.readdir(ownerPath, { withFileTypes: true }).catch(() => []);
    for (const canvasDir of canvasDirs) {
      if (canvasDir.isDirectory() && !canvasExists(canvasDir.name)) {
        await fs.rm(path.join(ownerPath, canvasDir.name), { recursive: true, force: true });
      }
    }
    const remaining = await fs.readdir(ownerPath).catch(() => ['keep']);
    if (remaining.length === 0) await fs.rmdir(ownerPath).catch(() => undefined);
  }
}
