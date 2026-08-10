import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { MaterializedArtifact, RuntimeArtifactCandidate, RuntimeArtifactHandle } from './contract.js';
import { assertRuntimeHandle, runtimeHandle } from './contract.js';

export const MANAGED_ARTIFACT_MAX_BYTES = 25 * 1024 * 1024;
export const MANAGED_ARTIFACT_MAX_FILES = 100;
export const MANAGED_ARTIFACT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

const TEMP_ROOT_NAME = '.convosketchpad-artifacts';
const MAX_DEPTH = 12;

export interface ManagedArtifactConfig {
  runtimeId: string;
  displayName: string;
  workingDirectory(): string;
}

export function managedArtifactToken(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 40);
}

function assertToken(token: string): void {
  if (!/^[a-f0-9]{40}$/.test(token)) throw new Error('Invalid managed Artifact token');
}

export function managedArtifactPaths(config: ManagedArtifactConfig, token: string): {
  root: string;
  turn: string;
  output: string;
  input: string;
} {
  assertToken(token);
  const root = path.join(config.workingDirectory(), TEMP_ROOT_NAME);
  const turn = path.join(root, token);
  return { root, turn, output: path.join(turn, 'outputs'), input: path.join(turn, 'inputs') };
}

export async function prepareManagedArtifactDirectory(
  config: ManagedArtifactConfig,
  idempotencyKey: string,
  createInput: boolean,
): Promise<{ token: string; outputDirectory: string; inputDirectory: string }> {
  const token = managedArtifactToken(idempotencyKey);
  const paths = managedArtifactPaths(config, token);
  await fs.rm(paths.turn, { recursive: true, force: true });
  await fs.mkdir(paths.output, { recursive: true, mode: 0o700 });
  if (createInput) await fs.mkdir(paths.input, { recursive: true, mode: 0o700 });
  return { token, outputDirectory: paths.output, inputDirectory: paths.input };
}

export async function discardManagedTurnFiles(config: ManagedArtifactConfig, token: string): Promise<void> {
  const paths = managedArtifactPaths(config, token);
  await fs.rm(paths.turn, { recursive: true, force: true });
  const entries = await fs.readdir(paths.root).catch(() => ['remaining']);
  if (entries.length === 0) await fs.rmdir(paths.root).catch(() => undefined);
}

function contained(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
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

export async function collectManagedTurnArtifacts(
  config: ManagedArtifactConfig,
  token: string,
  incomplete: boolean,
): Promise<{ artifacts: RuntimeArtifactCandidate[]; warnings: string[] }> {
  const paths = managedArtifactPaths(config, token);
  const realBase = await fs.realpath(paths.output).catch(() => null);
  if (!realBase) return { artifacts: [], warnings: [] };
  const canonicalBase = realBase;
  const artifacts: RuntimeArtifactCandidate[] = [];
  const warnings: string[] = [];
  let totalBytes = 0;

  async function reject(candidate: string): Promise<void> {
    await fs.rm(candidate, { recursive: true, force: true }).catch(() => undefined);
  }

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) {
      warnings.push(`${config.displayName} Artifact directory exceeds the maximum nesting depth`);
      return;
    }
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        warnings.push(`${entry.name}: symbolic links are not accepted as Artifacts`);
        await reject(candidate);
        continue;
      }
      if (entry.isDirectory()) {
        await visit(candidate, depth + 1);
        continue;
      }
      const stat = await fs.lstat(candidate);
      if (!stat.isFile() || stat.nlink !== 1) {
        warnings.push(`${entry.name}: only regular, non-linked files can be persisted`);
        await reject(candidate);
        continue;
      }
      if (!contained(canonicalBase, await fs.realpath(candidate))) {
        warnings.push(`${entry.name}: Artifact path escapes the managed output directory`);
        await reject(candidate);
        continue;
      }
      if (artifacts.length >= MANAGED_ARTIFACT_MAX_FILES) {
        warnings.push(`${config.displayName} Artifact file limit exceeded (${MANAGED_ARTIFACT_MAX_FILES})`);
        await reject(candidate);
        continue;
      }
      if (stat.size > MANAGED_ARTIFACT_MAX_BYTES || totalBytes + stat.size > MANAGED_ARTIFACT_MAX_TOTAL_BYTES) {
        warnings.push(`${entry.name}: Artifact exceeds the per-file or per-Turn persistence limit`);
        await reject(candidate);
        continue;
      }
      totalBytes += stat.size;
      const relativePath = path.relative(paths.output, candidate).split(path.sep).join('/');
      const sourceUri = `${config.runtimeId}-artifact:${token}:${encodeURIComponent(relativePath)}`;
      artifacts.push({
        name: relativePath,
        mimeType: inferMimeType(relativePath),
        sizeBytes: stat.size,
        uri: sourceUri,
        sourceUri,
        storage: 'source',
        available: true,
        ...(incomplete ? { warning: `${relativePath}: Turn did not complete; this Artifact may be incomplete` } : {}),
        runtimeArtifactRef: runtimeHandle(config.runtimeId, { kind: 'managed-file', token, relativePath }),
      });
    }
  }

  await visit(paths.output, 0);
  await fs.rm(paths.input, { recursive: true, force: true }).catch(() => undefined);
  if (artifacts.length === 0) await fs.rm(paths.turn, { recursive: true, force: true }).catch(() => undefined);
  return { artifacts, warnings };
}

export async function materializeManagedArtifact(
  config: ManagedArtifactConfig,
  handle: RuntimeArtifactHandle,
): Promise<MaterializedArtifact> {
  assertRuntimeHandle(handle, config.runtimeId);
  const { token, relativePath } = handle.opaque;
  const paths = managedArtifactPaths(config, token);
  if (handle.opaque.kind !== 'managed-file' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Unsupported ${config.displayName} managed Artifact handle`);
  }
  const candidate = path.resolve(paths.output, relativePath);
  if (!contained(paths.output, candidate)) throw new Error(`${config.displayName} Artifact path escapes its output directory`);
  const realBase = await fs.realpath(paths.output);
  const before = await fs.lstat(candidate);
  if (!before.isFile() || before.nlink !== 1) throw new Error(`${config.displayName} Artifact is not a regular, unlinked file`);
  if (!contained(realBase, await fs.realpath(candidate))) throw new Error(`${config.displayName} Artifact real path escapes its output directory`);
  const file = await fs.open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino) {
      throw new Error(`${config.displayName} Artifact changed during materialization`);
    }
    if (stat.size > MANAGED_ARTIFACT_MAX_BYTES) throw new Error(`${config.displayName} Artifact exceeds 25 MiB`);
    return { bytes: await file.readFile(), mimeType: inferMimeType(relativePath) };
  } finally {
    await file.close();
  }
}

export async function releaseManagedArtifact(config: ManagedArtifactConfig, handle: RuntimeArtifactHandle): Promise<void> {
  assertRuntimeHandle(handle, config.runtimeId);
  if (handle.opaque.kind !== 'managed-file') return;
  const { token, relativePath } = handle.opaque;
  const paths = managedArtifactPaths(config, token);
  if (!relativePath || path.isAbsolute(relativePath)) return;
  const candidate = path.resolve(paths.output, relativePath);
  if (!contained(paths.output, candidate)) return;
  await fs.rm(candidate, { force: true });
  let current = path.dirname(candidate);
  while (contained(paths.turn, current)) {
    const removed = await fs.rmdir(current).then(() => true).catch(() => false);
    if (!removed) break;
    current = path.dirname(current);
  }
  const outputEntries = await fs.readdir(paths.output).catch(() => null);
  if (outputEntries === null || outputEntries.length === 0) await fs.rm(paths.turn, { recursive: true, force: true });
  const rootEntries = await fs.readdir(paths.root).catch(() => ['remaining']);
  if (rootEntries.length === 0) await fs.rmdir(paths.root).catch(() => undefined);
}
