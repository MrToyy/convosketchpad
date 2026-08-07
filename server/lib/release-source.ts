/**
 * Official ConvoSketchpad release resolution helpers.
 *
 * Only published, stable GitHub Releases from the official repository are
 * trusted. Local and remote git tags are deliberately not update sources.
 */

export const OFFICIAL_RELEASE_REPO = 'MrToyy/convosketchpad';
export const OFFICIAL_ORIGIN_URL = `https://github.com/${OFFICIAL_RELEASE_REPO}.git`;

const SEMVER_TAG_REGEX = /^v?(\d+\.\d+\.\d+)$/;
const RELEASE_REQUEST_TIMEOUT_MS = 10_000;

export interface PublishedRelease {
  version: string;
  tag: string;
  url: string | null;
}

export type ReleaseLookupResult =
  | { status: 'found'; release: PublishedRelease }
  | { status: 'no-release' }
  | { status: 'unavailable'; error: string };

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function normalizeSemverTag(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const match = SEMVER_TAG_REGEX.exec(tag.trim());
  return match ? match[1] : null;
}

export function isOfficialOriginUrl(remoteUrl: string): boolean {
  const normalized = remoteUrl.trim().replace(/\/+$/, '').toLowerCase();
  return normalized === OFFICIAL_ORIGIN_URL.toLowerCase()
    || normalized === OFFICIAL_ORIGIN_URL.replace(/\.git$/, '').toLowerCase();
}

function releaseHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'convosketchpad-updater',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function githubRequestError(response: Response): string {
  const status = response.status;
  const retryAfterHeader = response.headers.get('retry-after')?.trim() || '';
  const retryAfter = /^\d+$/.test(retryAfterHeader) ? retryAfterHeader : null;
  const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
  const resetSeconds = Number(response.headers.get('x-ratelimit-reset'));

  if ((status === 403 || status === 429) && rateLimitRemaining === '0') {
    const resetDate = new Date(resetSeconds * 1_000);
    const reset = Number.isFinite(resetSeconds) && resetSeconds > 0 && !Number.isNaN(resetDate.getTime())
      ? ` The limit resets at ${resetDate.toISOString()}.`
      : '';
    const hint = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
      ? ' Wait for the reset or use a token with available quota.'
      : ' Set GITHUB_TOKEN or GH_TOKEN to increase the request limit.';
    return `GitHub API rate limit exceeded.${reset}${hint}`;
  }
  if ((status === 403 || status === 429) && retryAfter) {
    return `GitHub temporarily rejected the release request; retry after ${retryAfter} seconds.`;
  }
  if (status === 401 && (process.env.GITHUB_TOKEN || process.env.GH_TOKEN)) {
    return 'GitHub rejected GITHUB_TOKEN or GH_TOKEN; refresh the token or unset it to use unauthenticated requests.';
  }
  return `GitHub release request failed with HTTP ${status}`;
}

async function requestRelease(path: string): Promise<ReleaseLookupResult> {
  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${OFFICIAL_RELEASE_REPO}${path}`,
      {
        headers: releaseHeaders(),
        signal: AbortSignal.timeout(RELEASE_REQUEST_TIMEOUT_MS),
      },
    );
  } catch (err) {
    return {
      status: 'unavailable',
      error: err instanceof Error ? err.message : 'GitHub release request failed',
    };
  }

  if (response.status === 404) return { status: 'no-release' };
  if (!response.ok) {
    return {
      status: 'unavailable',
      error: githubRequestError(response),
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: 'unavailable', error: 'GitHub returned invalid release JSON' };
  }

  if (!payload || typeof payload !== 'object') {
    return { status: 'unavailable', error: 'GitHub returned an invalid release payload' };
  }

  const release = payload as Record<string, unknown>;
  if (release.draft === true || release.prerelease === true) {
    return { status: 'no-release' };
  }

  const tag = typeof release.tag_name === 'string' ? release.tag_name.trim() : '';
  const version = normalizeSemverTag(tag);
  if (!version || tag !== `v${version}`) {
    return {
      status: 'unavailable',
      error: 'Published release tag must use the exact vX.Y.Z format',
    };
  }

  return {
    status: 'found',
    release: {
      version,
      tag,
      url: typeof release.html_url === 'string' ? release.html_url : null,
    },
  };
}

export function lookupLatestRelease(): Promise<ReleaseLookupResult> {
  return requestRelease('/releases/latest');
}

export function lookupReleaseByVersion(version: string): Promise<ReleaseLookupResult> {
  return requestRelease(`/releases/tags/v${version}`);
}
