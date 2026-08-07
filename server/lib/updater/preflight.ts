/**
 * Preflight checks — verify the environment is ready for an update.
 */

import { execSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { isOfficialOriginUrl, OFFICIAL_ORIGIN_URL } from '../release-source.js';
import { isSupportedNodeVersion, MINIMUM_NODE_VERSION } from '../node-version.js';
import { EXIT_CODES, UpdateError } from './types.js';
import type { PreflightResult } from './types.js';

/**
 * Run all preflight checks. Throws UpdateError on any failure.
 */
export function runPreflight(cwd: string): PreflightResult {
  const gitVersion = requireCommand('git --version', 'git').replace('git version ', '').trim();
  const nodeVersionRaw = requireCommand('node --version', 'node').trim();
  const npmVersion = requireCommand('npm --version', 'npm').trim();

  // Validate Node.js version
  const nodeVersion = nodeVersionRaw.replace(/^v/, '');
  if (!isSupportedNodeVersion(nodeVersion)) {
    throw new UpdateError(
      `Node.js v${MINIMUM_NODE_VERSION}+ required, found v${nodeVersion}`,
      'preflight',
      EXIT_CODES.PREFLIGHT,
    );
  }

  // Verify cwd is a git repo
  try {
    execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' });
  } catch {
    throw new UpdateError(
      `${cwd} is not a git repository`,
      'preflight',
      EXIT_CODES.PREFLIGHT,
    );
  }

  // Only the official HTTPS origin may supply update code.
  try {
    const originUrl = execSync('git remote get-url origin', { cwd, stdio: 'pipe' }).toString().trim();
    if (!isOfficialOriginUrl(originUrl)) {
      throw new UpdateError(
        `Origin must be the official ConvoSketchpad repository (found: ${originUrl})\n  Fix: git remote set-url origin ${OFFICIAL_ORIGIN_URL}`,
        'preflight',
        EXIT_CODES.PREFLIGHT,
      );
    }
  } catch (err) {
    if (err instanceof UpdateError) throw err;
    throw new UpdateError(
      'Could not determine git remote URL',
      'preflight',
      EXIT_CODES.PREFLIGHT,
    );
  }

  // A forced release checkout cannot safely preserve working-tree changes.
  try {
    const status = execSync('git status --porcelain --untracked-files=normal', {
      cwd,
      stdio: 'pipe',
    }).toString();
    if (status.trim()) {
      throw new UpdateError(
        'Working tree is not clean. Commit, stash, or remove local changes before updating.',
        'preflight',
        EXIT_CODES.PREFLIGHT,
      );
    }
  } catch (err) {
    if (err instanceof UpdateError) throw err;
    throw new UpdateError(
      'Could not inspect git working tree status',
      'preflight',
      EXIT_CODES.PREFLIGHT,
    );
  }

  // Check write permissions
  try {
    accessSync(cwd, constants.W_OK);
  } catch {
    throw new UpdateError(
      `No write permission in ${cwd}`,
      'preflight',
      EXIT_CODES.PREFLIGHT,
    );
  }

  return {
    gitVersion,
    nodeVersion,
    npmVersion,
    isGitRepo: true,
    hasWritePermission: true,
    isClean: true,
  };
}

function requireCommand(cmd: string, name: string): string {
  try {
    return execSync(cmd, { stdio: 'pipe' }).toString();
  } catch {
    throw new UpdateError(
      `${name} not found — required for updates`,
      'preflight',
      EXIT_CODES.PREFLIGHT,
    );
  }
}
