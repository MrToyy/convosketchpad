/**
 * Safe workspace-path resolution used by Canvas attachments.
 *
 * Keeps attachment references inside the selected OpenClaw agent workspace.
 * @module
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from './config.js';

// ── Exclusion rules ──────────────────────────────────────────────────
const DEFAULT_EXCLUDED_NAMES = new Set([
  'node_modules', '.git', 'dist', 'build', 'server-dist', 'certs',
  '.env', 'agent-log.json',
]);

const DEFAULT_EXCLUDED_PATTERNS = [
  /^\.env(\.|$)/,   // .env, .env.local, .env.production, etc.
  /\.log$/,
];

export interface ResolveWorkspacePathOptions {
  allowNonExistent?: boolean;
}

/** Block sensitive and generated paths from Canvas attachment resolution. */
export function isExcluded(name: string): boolean {
  if (DEFAULT_EXCLUDED_NAMES.has(name)) return true;
  return DEFAULT_EXCLUDED_PATTERNS.some((pattern) => pattern.test(name));
}

// ── Workspace root ───────────────────────────────────────────────────

/** Resolve the explicit agent workspace or the configured default Canvas workspace. */
export function getWorkspaceRoot(workspaceRoot?: string): string {
  if (workspaceRoot && workspaceRoot.trim()) {
    return path.resolve(workspaceRoot);
  }

  return path.resolve(config.workspaceRoot);
}

// ── Path validation ──────────────────────────────────────────────────

/**
 * Validate and resolve a relative path to an absolute path within an explicit workspace root.
 */
export async function resolveWorkspacePathForRoot(
  workspaceRoot: string,
  relativePath: string,
  options?: ResolveWorkspacePathOptions,
): Promise<string | null> {
  const root = getWorkspaceRoot(workspaceRoot);
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
  const realRoot = await fs.realpath(root).catch(() => root);
  const realRootPrefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  const isWithinLexicalRoot = (candidate: string) => candidate === root || candidate.startsWith(rootPrefix);
  const isWithinRealRoot = (candidate: string) => candidate === realRoot || candidate.startsWith(realRootPrefix);

  // Block obvious traversal attempts
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    return null;
  }

  // Check each path segment for exclusions
  const segments = normalized.split(path.sep);
  if (segments.some((segment) => segment && isExcluded(segment))) {
    return null;
  }

  const resolved = path.resolve(root, normalized);

  // Must be within workspace root
  if (!isWithinLexicalRoot(resolved)) {
    return null;
  }

  // Resolve symlinks and re-check
  try {
    const real = await fs.realpath(resolved);
    if (!isWithinRealRoot(real)) {
      return null;
    }
    return resolved;
  } catch {
    // File doesn't exist
    if (!options?.allowNonExistent) return null;

    // Walk up until we find an existing ancestor. This allows creating the
    // first file in a fresh workspace, or nested paths whose parents will be
    // created later via mkdir({ recursive: true }).
    let current = path.dirname(resolved);
    while (current !== root) {
      try {
        const realCurrent = await fs.realpath(current);
        if (!isWithinRealRoot(realCurrent)) {
          return null;
        }
        return resolved;
      } catch {
        const next = path.dirname(current);
        if (next === current) {
          return null;
        }
        current = next;
      }
    }

    if (!isWithinRealRoot(realRoot)) {
      return null;
    }

    return resolved;
  }
}

/**
 * Validate and resolve a relative path to an absolute path within the default workspace.
 */
export async function resolveWorkspacePath(
  relativePath: string,
  options?: ResolveWorkspacePathOptions,
): Promise<string | null> {
  return resolveWorkspacePathForRoot(getWorkspaceRoot(), relativePath, options);
}
