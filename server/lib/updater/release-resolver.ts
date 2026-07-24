/** Resolve update targets exclusively from official GitHub Releases. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compareSemver,
  lookupLatestRelease,
  lookupReleaseByVersion,
  normalizeSemverTag,
} from '../release-source.js';
import { EXIT_CODES, UpdateError } from './types.js';
import type { ResolvedVersion } from './types.js';

export async function resolveVersion(cwd: string, explicitVersion?: string): Promise<ResolvedVersion> {
  const pkgPath = join(cwd, 'package.json');
  let current: string;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    current = pkg.version;
  } catch {
    throw new UpdateError(
      `Cannot read ${pkgPath}`,
      'resolve',
      EXIT_CODES.VERSION_RESOLUTION,
    );
  }

  const normalized = explicitVersion ? normalizeSemverTag(explicitVersion) : null;
  if (explicitVersion && !normalized) {
    throw new UpdateError(
      `Invalid version ${explicitVersion} (expected vX.Y.Z)`,
      'resolve',
      EXIT_CODES.VERSION_RESOLUTION,
    );
  }

  const lookup = normalized
    ? await lookupReleaseByVersion(normalized)
    : await lookupLatestRelease();

  if (lookup.status === 'unavailable') {
    throw new UpdateError(
      `Could not query official ConvoSketchpad releases: ${lookup.error}`,
      'resolve',
      EXIT_CODES.VERSION_RESOLUTION,
    );
  }

  if (lookup.status === 'no-release') {
    throw new UpdateError(
      normalized
        ? `Official ConvoSketchpad release v${normalized} was not found`
        : 'No official ConvoSketchpad release has been published',
      'resolve',
      EXIT_CODES.VERSION_RESOLUTION,
    );
  }

  const { version, tag } = lookup.release;
  const comparison = compareSemver(version, current);
  if (comparison < 0) {
    throw new UpdateError(
      `Refusing to downgrade v${current} to v${version}`,
      'resolve',
      EXIT_CODES.VERSION_RESOLUTION,
    );
  }

  return {
    tag,
    version,
    current,
    isUpToDate: comparison === 0,
    source: normalized ? 'explicit' : 'release',
  };
}
