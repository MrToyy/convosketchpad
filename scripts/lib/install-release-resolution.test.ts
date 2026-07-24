import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const installer = readFileSync(resolve(process.cwd(), 'install.sh'), 'utf-8');
const helperStart = installer.indexOf('normalize_version_tag() {');
const helperEnd = installer.indexOf('\nSTAGE_CURRENT=');

if (helperStart < 0 || helperEnd < 0) {
  throw new Error('Could not locate installer release helper block');
}

const releaseHelpers = installer.slice(helperStart, helperEnd);

function runResolver(
  command: string,
  response: object,
  curlStatus = 0,
  repo = 'https://github.com/MrToyy/convosketchpad.git',
) {
  const script = `
set -euo pipefail
REPO="$3"
GITHUB_TOKEN=""
GH_TOKEN=""
MOCK_RESPONSE="$1"
MOCK_CURL_STATUS="$2"
curl() {
  printf '%s' "$MOCK_RESPONSE"
  return "$MOCK_CURL_STATUS"
}
${releaseHelpers}
${command}
`;

  return spawnSync(
    'bash',
    ['-c', script, 'installer-release-test', JSON.stringify(response), String(curlStatus), repo],
    { encoding: 'utf-8' },
  );
}

describe('installer release resolution', () => {
  it('resolves the latest official stable Release', () => {
    const result = runResolver('fetch_latest_release_tag', {
      tag_name: 'v0.2.0',
      draft: false,
      prerelease: false,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('v0.2.0\n');
  });

  it('resolves an exact official stable Release', () => {
    const result = runResolver('fetch_stable_release_tag v0.2.0', {
      tag_name: 'v0.2.0',
      draft: false,
      prerelease: false,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('v0.2.0\n');
  });

  it.each([
    { tag_name: 'v0.2.0', draft: true, prerelease: false },
    { tag_name: 'v0.2.0', draft: false, prerelease: true },
    { tag_name: 'v1.5.3', draft: false, prerelease: false },
  ])('rejects a non-stable or mismatched exact Release: %j', (response) => {
    const result = runResolver('fetch_stable_release_tag v0.2.0', response);
    expect(result.status).not.toBe(0);
  });

  it('fails closed when the GitHub API is unavailable', () => {
    const result = runResolver('fetch_latest_release_tag', {}, 22);
    expect(result.status).not.toBe(0);
  });

  it('rejects Releases from a fork', () => {
    const result = runResolver(
      'fetch_stable_release_tag v0.2.0',
      { tag_name: 'v0.2.0', draft: false, prerelease: false },
      0,
      'https://github.com/example/convosketchpad.git',
    );
    expect(result.status).not.toBe(0);
  });

  it('contains no implicit branch fallback', () => {
    expect(installer).not.toContain('branch-fallback');
    expect(installer).not.toContain('falling back to branch');
  });
});
