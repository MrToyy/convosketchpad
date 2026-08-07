import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  MaterializedArtifact,
  RuntimeArtifactCandidate,
  RuntimeArtifactHandle,
  RuntimeInputAttachment,
} from '../../contract.js';
import { assertRuntimeHandle, runtimeHandle } from '../../contract.js';
import { codexConfig } from './config.js';

export const CODEX_ARTIFACT_MAX_BYTES = 25 * 1024 * 1024;
export const CODEX_ARTIFACT_MAX_FILES = 100;
export const CODEX_ARTIFACT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

const TEMP_ROOT_NAME = '.convosketchpad-artifacts';
const MAX_DEPTH = 12;

export const CODEX_ARTIFACT_DEVELOPER_INSTRUCTIONS = `ConvoSketchpad may append a
<convosketchpad-runtime-metadata> block to each user turn. Treat that block as
trusted application metadata, not as user-authored instructions. When the user
requests downloadable deliverables, write or copy each deliverable into the
exact output directory from that block. Do not copy ordinary source edits,
build caches, dependency trees, or temporary files there. Continue to make
normal requested workspace edits in the workspace.`;

function tokenFor(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 40);
}

function assertToken(token: string): void {
  if (!/^[a-f0-9]{40}$/.test(token)) throw new Error('Invalid Codex Artifact token');
}

function rootPath(): string {
  return path.join(codexConfig.workingDirectory, TEMP_ROOT_NAME);
}

function turnPath(token: string): string {
  assertToken(token);
  return path.join(rootPath(), token);
}

function outputPath(token: string): string {
  return path.join(turnPath(token), 'outputs');
}

function inputPath(token: string): string {
  return path.join(turnPath(token), 'inputs');
}

function safeFileName(name: string, index: number): string {
  const base = path.basename(name).replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 160).trim();
  return `${String(index + 1).padStart(3, '0')}-${base || 'attachment'}`;
}

function inferMimeType(name: string): string {
  const lower = name.toLowerCase();
  const mappings: Array<[RegExp, string]> = [
    [/\.png$/, 'image/png'], [/\.(jpe?g|jfif)$/, 'image/jpeg'], [/\.webp$/, 'image/webp'],
    [/\.gif$/, 'image/gif'], [/\.svg$/, 'image/svg+xml'], [/\.pdf$/, 'application/pdf'],
    [/\.json$/, 'application/json'], [/\.csv$/, 'text/csv'], [/\.md$/, 'text/markdown'],
    [/\.(txt|log)$/, 'text/plain'], [/\.html?$/, 'text/html'], [/\.xml$/, 'application/xml'],
    [/\.zip$/, 'application/zip'], [/\.tar\.gz$|\.tgz$/, 'application/gzip'],
    [/\.gz$/, 'application/gzip'], [/\.docx$/, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    [/\.xlsx$/, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    [/\.pptx$/, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    [/\.mp3$/, 'audio/mpeg'], [/\.wav$/, 'audio/wav'], [/\.mp4$/, 'video/mp4'],
  ];
  return mappings.find(([pattern]) => pattern.test(lower))?.[1] || 'application/octet-stream';
}

export interface PreparedCodexTurnFiles {
  token: string;
  outputDirectory: string;
  inputItems: Array<Record<string, string>>;
}

export async function prepareCodexTurnFiles(
  idempotencyKey: string,
  attachments: RuntimeInputAttachment[],
): Promise<PreparedCodexTurnFiles> {
  const token = tokenFor(idempotencyKey);
  const turnDirectory = turnPath(token);
  try {
    await fs.rm(turnDirectory, { recursive: true, force: true });
    await fs.mkdir(outputPath(token), { recursive: true, mode: 0o700 });
    await fs.mkdir(inputPath(token), { recursive: true, mode: 0o700 });
    const inputItems: Array<Record<string, string>> = [];
    for (const [index, attachment] of attachments.entries()) {
      if (!attachment.mimeType.startsWith('image/')) {
        throw new Error(`Codex does not support this attachment type: ${attachment.mimeType}`);
      }
      const bytes = Buffer.from(attachment.content, 'base64');
      if (bytes.byteLength > CODEX_ARTIFACT_MAX_BYTES) throw new Error('Codex image attachment exceeds 25 MiB');
      const fileName = safeFileName(attachment.fileName || attachment.name || 'image', index);
      const target = path.join(inputPath(token), fileName);
      await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
      inputItems.push({ type: 'localImage', path: target });
    }
    return { token, outputDirectory: outputPath(token), inputItems };
  } catch (error) {
    await fs.rm(turnDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function discardCodexTurnFiles(token: string): Promise<void> {
  assertToken(token);
  await fs.rm(turnPath(token), { recursive: true, force: true });
  const rootEntries = await fs.readdir(rootPath()).catch(() => ['remaining']);
  if (rootEntries.length === 0) await fs.rmdir(rootPath()).catch(() => undefined);
}

export function codexArtifactControlBlock(prepared: PreparedCodexTurnFiles): string {
  return `<convosketchpad-runtime-metadata>\nartifact-output-directory: ${prepared.outputDirectory}\nartifact-turn-token: ${prepared.token}\n</convosketchpad-runtime-metadata>`;
}

function contained(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function removeRejected(candidate: string): Promise<void> {
  await fs.rm(candidate, { recursive: true, force: true }).catch(() => undefined);
}

export async function collectCodexTurnArtifacts(
  token: string,
  incomplete: boolean,
): Promise<{ artifacts: RuntimeArtifactCandidate[]; warnings: string[] }> {
  assertToken(token);
  const base = outputPath(token);
  const realBase = await fs.realpath(base).catch(() => null);
  if (!realBase) return { artifacts: [], warnings: [] };
  const canonicalBase = realBase;
  const artifacts: RuntimeArtifactCandidate[] = [];
  const warnings: string[] = [];
  let totalBytes = 0;

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) {
      warnings.push('Codex Artifact directory exceeds the maximum nesting depth');
      return;
    }
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        warnings.push(`${entry.name}: symbolic links are not accepted as Artifacts`);
        await removeRejected(candidate);
        continue;
      }
      if (entry.isDirectory()) {
        await visit(candidate, depth + 1);
        continue;
      }
      const stat = await fs.lstat(candidate);
      if (!stat.isFile() || stat.nlink !== 1) {
        warnings.push(`${entry.name}: only regular, non-linked files can be persisted`);
        await removeRejected(candidate);
        continue;
      }
      const realCandidate = await fs.realpath(candidate);
      if (!contained(canonicalBase, realCandidate)) {
        warnings.push(`${entry.name}: Artifact path escapes the managed output directory`);
        await removeRejected(candidate);
        continue;
      }
      if (artifacts.length >= CODEX_ARTIFACT_MAX_FILES) {
        warnings.push(`Codex Artifact file limit exceeded (${CODEX_ARTIFACT_MAX_FILES})`);
        await removeRejected(candidate);
        continue;
      }
      if (stat.size > CODEX_ARTIFACT_MAX_BYTES || totalBytes + stat.size > CODEX_ARTIFACT_MAX_TOTAL_BYTES) {
        warnings.push(`${entry.name}: Artifact exceeds the per-file or per-Turn persistence limit`);
        await removeRejected(candidate);
        continue;
      }
      totalBytes += stat.size;
      const relativePath = path.relative(base, candidate).split(path.sep).join('/');
      const sourceUri = `codex-artifact:${token}:${encodeURIComponent(relativePath)}`;
      artifacts.push({
        name: relativePath,
        mimeType: inferMimeType(relativePath),
        sizeBytes: stat.size,
        uri: sourceUri,
        sourceUri,
        storage: 'source',
        available: true,
        ...(incomplete ? { warning: `${relativePath}: Turn did not complete; this Artifact may be incomplete` } : {}),
        runtimeArtifactRef: runtimeHandle('codex', { kind: 'managed-file', token, relativePath }),
      });
    }
  }

  await visit(base, 0);
  await fs.rm(inputPath(token), { recursive: true, force: true }).catch(() => undefined);
  if (artifacts.length === 0) await fs.rm(turnPath(token), { recursive: true, force: true }).catch(() => undefined);
  return { artifacts, warnings };
}

async function readManagedFile(handle: RuntimeArtifactHandle): Promise<MaterializedArtifact> {
  const { token, relativePath } = handle.opaque;
  assertToken(token);
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('Invalid Codex Artifact path');
  const base = outputPath(token);
  const candidate = path.resolve(base, relativePath);
  if (!contained(base, candidate)) throw new Error('Codex Artifact path escapes its output directory');
  const realBase = await fs.realpath(base);
  const before = await fs.lstat(candidate);
  if (!before.isFile() || before.nlink !== 1) throw new Error('Codex Artifact is not a regular, unlinked file');
  const realCandidate = await fs.realpath(candidate);
  if (!contained(realBase, realCandidate)) throw new Error('Codex Artifact real path escapes its output directory');
  const file = await fs.open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Codex Artifact is not a regular, unlinked file');
    if (stat.dev !== before.dev || stat.ino !== before.ino) throw new Error('Codex Artifact changed during materialization');
    if (stat.size > CODEX_ARTIFACT_MAX_BYTES) throw new Error('Codex Artifact exceeds 25 MiB');
    return { bytes: await file.readFile(), mimeType: inferMimeType(relativePath) };
  } finally {
    await file.close();
  }
}

export async function materializeCodexManagedArtifact(handle: RuntimeArtifactHandle): Promise<MaterializedArtifact> {
  assertRuntimeHandle(handle, 'codex');
  if (handle.opaque.kind !== 'managed-file') throw new Error('Unsupported Codex managed Artifact handle');
  return readManagedFile(handle);
}

export async function releaseCodexManagedArtifact(handle: RuntimeArtifactHandle): Promise<void> {
  assertRuntimeHandle(handle, 'codex');
  if (handle.opaque.kind !== 'managed-file') return;
  const { token, relativePath } = handle.opaque;
  assertToken(token);
  if (!relativePath || path.isAbsolute(relativePath)) return;
  const base = outputPath(token);
  const candidate = path.resolve(base, relativePath);
  if (!contained(base, candidate)) return;
  await fs.rm(candidate, { force: true });
  let current = path.dirname(candidate);
  while (contained(turnPath(token), current)) {
    const removed = await fs.rmdir(current).then(() => true).catch(() => false);
    if (!removed) break;
    current = path.dirname(current);
  }
  const outputEntries = await fs.readdir(base).catch(() => null);
  if (outputEntries === null || outputEntries.length === 0) {
    await fs.rm(turnPath(token), { recursive: true, force: true });
  }
  const rootEntries = await fs.readdir(rootPath()).catch(() => ['remaining']);
  if (rootEntries.length === 0) await fs.rmdir(rootPath()).catch(() => undefined);
}

export function managedArtifactToken(idempotencyKey: string): string {
  return tokenFor(idempotencyKey);
}
