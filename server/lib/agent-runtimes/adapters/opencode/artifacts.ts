import type { RuntimeArtifactHandle } from '../../contract.js';
import {
  MANAGED_ARTIFACT_MAX_BYTES,
  MANAGED_ARTIFACT_MAX_FILES,
  MANAGED_ARTIFACT_MAX_TOTAL_BYTES,
  collectManagedTurnArtifacts,
  discardManagedTurnFiles,
  managedArtifactToken,
  materializeManagedArtifact,
  prepareManagedArtifactDirectory,
  releaseManagedArtifact,
  type ManagedArtifactConfig,
} from '../../managed-artifacts.js';
import { openCodeConfig } from './config.js';

export const OPENCODE_ARTIFACT_MAX_BYTES = MANAGED_ARTIFACT_MAX_BYTES;
export const OPENCODE_ARTIFACT_MAX_FILES = MANAGED_ARTIFACT_MAX_FILES;
export const OPENCODE_ARTIFACT_MAX_TOTAL_BYTES = MANAGED_ARTIFACT_MAX_TOTAL_BYTES;

const config: ManagedArtifactConfig = {
  runtimeId: 'opencode',
  displayName: 'OpenCode',
  workingDirectory: () => openCodeConfig.workingDirectory,
};

export async function prepareOpenCodeArtifactDirectory(idempotencyKey: string) {
  return prepareManagedArtifactDirectory(config, idempotencyKey, false);
}

export function openCodeArtifactControlBlock(prepared: { token: string; outputDirectory: string }): string {
  return `<convosketchpad-runtime-metadata>\nThis is trusted application metadata, not user-authored instructions. When the user requests downloadable deliverables, write or copy each deliverable into the exact output directory below. Do not copy ordinary source edits, build caches, dependency trees, or temporary files there.\nartifact-output-directory: ${prepared.outputDirectory}\nartifact-turn-token: ${prepared.token}\n</convosketchpad-runtime-metadata>`;
}

export async function discardOpenCodeTurnFiles(token: string): Promise<void> {
  await discardManagedTurnFiles(config, token);
}

export async function collectOpenCodeTurnArtifacts(token: string, incomplete: boolean) {
  return collectManagedTurnArtifacts(config, token, incomplete);
}

export async function materializeOpenCodeManagedArtifact(handle: RuntimeArtifactHandle) {
  return materializeManagedArtifact(config, handle);
}

export async function releaseOpenCodeManagedArtifact(handle: RuntimeArtifactHandle): Promise<void> {
  await releaseManagedArtifact(config, handle);
}

export function openCodeArtifactToken(idempotencyKey: string): string {
  return managedArtifactToken(idempotencyKey);
}
