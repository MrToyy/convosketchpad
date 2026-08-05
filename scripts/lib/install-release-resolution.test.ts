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
const nodeVersionHelperStart = installer.indexOf('node_version_supported() {');
const nodeVersionHelperEnd = installer.indexOf('\ncheck_node() {');

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

  it('delegates Runtime configuration to setup instead of reading or writing OpenClaw config', () => {
    expect(installer).not.toContain('openclaw_config_value');
    expect(installer).not.toContain('detect_gateway_token');
    expect(installer).not.toContain('AGENT_RUNTIMES=openclaw');
    expect(installer).not.toMatch(/cat\s*>\s*\.env/);
    expect(installer).toContain('npm run setup');
    expect(installer).toContain('--skip-setup requires an existing');
  });

  it('enforces the complete Node.js minimum version', () => {
    expect(nodeVersionHelperStart).toBeGreaterThanOrEqual(0);
    expect(nodeVersionHelperEnd).toBeGreaterThan(nodeVersionHelperStart);
    const helper = installer.slice(nodeVersionHelperStart, nodeVersionHelperEnd);
    const result = spawnSync('bash', ['-c', `
${helper}
node_version_supported 22.12.9 22.13.0 && exit 10
node_version_supported 22.13.0 22.13.0 || exit 11
node_version_supported 23.0.0 22.13.0 || exit 12
`], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
  });

  it('rejects ambiguous, duplicate, and mixed help arguments before installation starts', () => {
    const installerPath = resolve(process.cwd(), 'install.sh');
    for (const args of [
      ['--gateway-token', '--dry-run'],
      ['--dry-run', '--dry-run'],
      ['--help', '--dry-run'],
      ['--help', '--unknown'],
    ]) {
      const result = spawnSync('bash', [installerPath, ...args], { encoding: 'utf-8' });
      expect(result.status, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`).not.toBe(0);
    }
    expect(spawnSync('bash', [installerPath, '--help'], { encoding: 'utf-8' }).status).toBe(0);
  });

  it('delegates existing stable Release upgrades to the transactional updater', () => {
    expect(installer).toContain('The installer cannot upgrade an existing stable Release safely');
    expect(installer).toContain('npm run update -- --version ${TARGET_REF}');
    expect(installer).toContain('Refusing to overwrite a dirty installation');
    expect(installer).not.toContain('Continue and overwrite local changes?');
  });

  it('installs and restarts systemd units through a single privileged path', () => {
    expect(installer).toContain('sudo -n "$@"');
    expect(installer).toContain('systemctl restart convosketchpad.service');
    expect(installer).not.toContain('sudo systemctl stop convosketchpad.service');
    expect(installer).not.toContain('To install as a systemd service (requires sudo)');
  });
});
