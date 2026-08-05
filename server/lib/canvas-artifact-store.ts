import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import type { AgentRuntimeResolver } from './canvas/application/ports.js';
import type { CanvasArtifact, CanvasAttachment, OwnedInteractionRecord } from './canvas/model.js';

export const CANVAS_ARTIFACT_MAX_BYTES = 25 * 1024 * 1024;
const ARTIFACT_ID_PATTERN = /^[a-f0-9]{40}$/;

export interface MaterializedCanvasArtifacts {
  artifacts: CanvasArtifact[];
  complete: boolean;
  warnings: string[];
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

function derivativeFilePath(ownerId: string, canvasId: string, derivativeId: string): string {
  if (!ARTIFACT_ID_PATTERN.test(derivativeId)) throw new Error('Invalid Canvas media derivative ID');
  return path.join(canvasDirectory(ownerId, canvasId), 'derivatives', derivativeId);
}

export async function persistCanvasMediaDerivative(
  ownerId: string,
  canvasId: string,
  bytes: Uint8Array,
): Promise<string> {
  if (bytes.byteLength > CANVAS_ARTIFACT_MAX_BYTES) {
    throw new Error('Canvas media derivative exceeds the 25 MiB persistence limit');
  }
  const id = createHash('sha256').update(bytes).digest('hex').slice(0, 40);
  const target = derivativeFilePath(ownerId, canvasId, id);
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
  return id;
}

export async function readCanvasMediaDerivative(
  ownerId: string,
  canvasId: string,
  derivativeId: string,
): Promise<Uint8Array | null> {
  if (!ARTIFACT_ID_PATTERN.test(derivativeId)) return null;
  return fs.readFile(derivativeFilePath(ownerId, canvasId, derivativeId)).catch(() => null);
}

export async function persistCanvasAttachment(
  ownerId: string,
  canvasId: string,
  input: { name: string; mimeType: string; bytes: Uint8Array },
): Promise<CanvasAttachment> {
  if (input.bytes.byteLength > CANVAS_ARTIFACT_MAX_BYTES) {
    throw new Error(`${input.name}: Attachment exceeds the 25 MiB persistence limit`);
  }
  const contentHash = createHash('sha256').update(input.bytes).digest('hex');
  const id = contentHash.slice(0, 40);
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
    contentHash,
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

async function loadSourceBytes(
  interaction: OwnedInteractionRecord,
  artifact: CanvasArtifact,
  resolveRuntime: AgentRuntimeResolver,
): Promise<{ bytes: Uint8Array; mimeType?: string }> {
  const uri = artifactSourceUri(artifact);
  const runtimeId = interaction.runtimeId;
  const runtime = resolveRuntime(runtimeId);
  if (!interaction.conversationRef) throw new Error('Interaction has no Runtime conversation reference');
  const handle = artifact.runtimeArtifactRef || runtime.createArtifactHandle({
    sourceUri: uri,
    profile: { runtimeId, profileId: interaction.agentProfileId },
    conversationRef: interaction.conversationRef,
    ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
  });
  const materialized = await runtime.materializeArtifact(handle);
  if (!materialized.bytes) throw new Error('Agent Runtime returned no persistable Artifact bytes');
  if (materialized.bytes.byteLength > CANVAS_ARTIFACT_MAX_BYTES) {
    throw new Error('Artifact exceeds the 25 MiB persistence limit');
  }
  return { bytes: materialized.bytes, mimeType: artifact.mimeType || materialized.mimeType };
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
  const contentHash = createHash('sha256').update(bytes).digest('hex');
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
    contentHash,
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
  resolveRuntime?: AgentRuntimeResolver,
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
      if (!resolveRuntime) throw new Error('Agent Runtime resolver is required to materialize this Artifact');
      const loaded = await loadSourceBytes(interaction, extracted, resolveRuntime);
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
