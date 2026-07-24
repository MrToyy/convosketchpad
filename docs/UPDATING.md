# Updating ConvoSketchpad

ConvoSketchpad includes a terminal-driven updater for published stable releases, beginning with version `0.2.0`.

Only releases from `https://github.com/MrToyy/convosketchpad` are accepted. Local tags, tags inherited from OpenClaw Nerve, forks, branches, drafts, and prereleases are never update sources.

The status-bar update entry is available only when managed authentication is disabled. On managed deployments, a host administrator must run the updater directly in the server terminal.

## Prerequisites

The checkout must:

- use Node.js 22 or newer;
- have `git` and `npm`;
- have a clean working tree, including no staged, unstaged, or untracked files;
- use the official HTTPS origin:

```bash
git remote set-url origin https://github.com/MrToyy/convosketchpad.git
```

The updater always refuses a dirty checkout, including with `--yes`, because release checkout cannot preserve uncommitted work.

## Quick start

Preview the resolved release without changing files:

```bash
npm run update -- --dry-run
```

Run the update with an interactive confirmation:

```bash
npm run update
```

The updater:

1. validates the tools, official origin, permissions, and clean working tree;
2. resolves a published stable Release from the official GitHub repository;
3. snapshots the current commit and `.env`;
4. fetches only the selected Release tag into an internal ref;
5. verifies that the target is the matching `convosketchpad` package;
6. runs `npm ci` and `npm run build`;
7. restarts the exact `convosketchpad.service` or `com.mrtoyy.convosketchpad` service when present;
8. verifies `/health` and `/api/version`.

## CLI flags

| Flag | Description |
|---|---|
| `--version <vX.Y.Z>` | Select an existing official stable Release |
| `--yes`, `-y` | Skip the terminal confirmation; does not bypass safety checks |
| `--dry-run` | Resolve and validate the target without changing the checkout |
| `--verbose`, `-v` | Show detailed update operations |
| `--rollback` | Restore the last-known-good snapshot |
| `--no-restart` | Skip service restart and health checks |
| `--help`, `-h` | Show help |

## Examples

```bash
# Preview first
npm run update -- --dry-run

# Select a published stable release
npm run update -- --version v0.2.0

# Roll back to the previous snapshot
npm run update -- --rollback

# Update and restart manually
npm run update -- --no-restart
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Already up to date |
| 10 | Preflight failure |
| 20 | Official Release resolution failure |
| 40 | Fetch, validation, install, or build failure |
| 50 | Service restart failure |
| 60 | Health check failure |
| 70 | Rollback failure |
| 80 | Another updater process holds the lock |

## Rollback and state

Before checkout, the updater records the current commit, package version, timestamp, and `.env` hash. When `.env` exists, it is copied with mode `0600`. State is stored under `~/.convosketchpad/updater/`.

If fetching, validation, building, restarting, or health checking fails after the snapshot, the updater checks out the saved commit, runs `npm ci` and `npm run build`, and restarts the detected service.

| Path | Purpose |
|---|---|
| `~/.convosketchpad/updater/last-good.json` | Last-known-good snapshot |
| `~/.convosketchpad/updater/last-run.json` | Most recent update result |
| `~/.convosketchpad/updater/snapshots/<timestamp>/.env` | Protected `.env` backup |
| `~/.convosketchpad/updater/update.lock` | Concurrent-update lock |

## Release policy

Version `0.1.0` intentionally has no GitHub Release. To prepare a release, update `package.json` and `package-lock.json`, add a dated matching section to `CHANGELOG.md`, push the release commit to `main`, and run the manual **Release** GitHub Actions workflow with the matching `X.Y.Z` input.

The workflow validates, tests, builds, audits, and starts the exact `main` commit on Ubuntu and macOS before creating an annotated `vX.Y.Z` tag and a Draft GitHub Release. Review the Draft notes and installation behavior, then publish it as Latest:

```bash
gh release edit vX.Y.Z --draft=false --latest
```

Drafts and prereleases are never offered by the installer or updater.

## Troubleshooting

### No stable release can be resolved

Check the repository Releases page and GitHub API availability. The installer fails closed instead of installing an unreleased branch. Local tags, inherited tags, Drafts, and prereleases are intentionally ignored; use `--branch main` only for an explicit development installation.

### Working tree is not clean

Inspect the checkout and commit, stash, or remove the reported changes:

```bash
git status --short
```

### Official origin required

```bash
git remote -v
git remote set-url origin https://github.com/MrToyy/convosketchpad.git
```

### Build or health check failure

The updater attempts rollback automatically. If manual recovery is required:

```bash
cat ~/.convosketchpad/updater/last-good.json
git checkout --force <snapshot-ref>
npm ci
npm run build
sudo systemctl restart convosketchpad.service
```
