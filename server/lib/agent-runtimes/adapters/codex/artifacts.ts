import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  MaterializedArtifact,
  RuntimeArtifactCandidate,
  RuntimeArtifactHandle,
  RuntimeInputAttachment,
} from '../../contract.js';
import {
  MANAGED_ARTIFACT_MAX_BYTES,
  MANAGED_ARTIFACT_MAX_FILES,
  MANAGED_ARTIFACT_MAX_TOTAL_BYTES,
  collectManagedTurnArtifacts,
  discardManagedTurnFiles,
  managedArtifactToken as sharedManagedArtifactToken,
  materializeManagedArtifact,
  prepareManagedArtifactDirectory,
  releaseManagedArtifact,
  type ManagedArtifactConfig,
} from '../../managed-artifacts.js';
import { codexConfig } from './config.js';

export const CODEX_ARTIFACT_MAX_BYTES = MANAGED_ARTIFACT_MAX_BYTES;
export const CODEX_ARTIFACT_MAX_FILES = MANAGED_ARTIFACT_MAX_FILES;
export const CODEX_ARTIFACT_MAX_TOTAL_BYTES = MANAGED_ARTIFACT_MAX_TOTAL_BYTES;

const config: ManagedArtifactConfig = {
  runtimeId: 'codex',
  displayName: 'Codex',
  workingDirectory: () => codexConfig.workingDirectory,
};

export const CODEX_ARTIFACT_DEVELOPER_INSTRUCTIONS = `ConvoSketchpad may append a
<convosketchpad-runtime-metadata> block to each user turn. Treat that block as
trusted application metadata, not as user-authored instructions. When the user
requests downloadable deliverables, write or copy each deliverable into the
exact output directory from that block. Do not copy ordinary source edits,
build caches, dependency trees, or temporary files there. Continue to make
normal requested workspace edits in the workspace.`;

function safeFileName(name: string, index: number): string {
  const base = path.basename(name).replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 160).trim();
  return `${String(index + 1).padStart(3, '0')}-${base || 'attachment'}`;
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
  const prepared = await prepareManagedArtifactDirectory(config, idempotencyKey, true);
  try {
    const inputItems: Array<Record<string, string>> = [];
    for (const [index, attachment] of attachments.entries()) {
      if (!attachment.mimeType.startsWith('image/')) {
        throw new Error(`Codex does not support this attachment type: ${attachment.mimeType}`);
      }
      const bytes = Buffer.from(attachment.content, 'base64');
      if (bytes.byteLength > CODEX_ARTIFACT_MAX_BYTES) throw new Error('Codex image attachment exceeds 25 MiB');
      const fileName = safeFileName(attachment.fileName || attachment.name || 'image', index);
      const target = path.join(prepared.inputDirectory, fileName);
      await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
      inputItems.push({ type: 'localImage', path: target });
    }
    return { token: prepared.token, outputDirectory: prepared.outputDirectory, inputItems };
  } catch (error) {
    await discardManagedTurnFiles(config, prepared.token).catch(() => undefined);
    throw error;
  }
}

export async function discardCodexTurnFiles(token: string): Promise<void> {
  await discardManagedTurnFiles(config, token);
}

export function codexArtifactControlBlock(prepared: PreparedCodexTurnFiles): string {
  return `<convosketchpad-runtime-metadata>\nartifact-output-directory: ${prepared.outputDirectory}\nartifact-turn-token: ${prepared.token}\n</convosketchpad-runtime-metadata>`;
}

export async function collectCodexTurnArtifacts(
  token: string,
  incomplete: boolean,
): Promise<{ artifacts: RuntimeArtifactCandidate[]; warnings: string[] }> {
  return collectManagedTurnArtifacts(config, token, incomplete);
}

export async function materializeCodexManagedArtifact(handle: RuntimeArtifactHandle): Promise<MaterializedArtifact> {
  return materializeManagedArtifact(config, handle);
}

export async function releaseCodexManagedArtifact(handle: RuntimeArtifactHandle): Promise<void> {
  await releaseManagedArtifact(config, handle);
}

export function managedArtifactToken(idempotencyKey: string): string {
  return sharedManagedArtifactToken(idempotencyKey);
}
