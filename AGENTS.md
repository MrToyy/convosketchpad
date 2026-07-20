# Repository Branch Workflow

## Branch roles

- `master` is the clean mirror of `upstream/master`. Use it only to synchronize upstream changes; do not develop features or create project-specific commits on it.
- `feat/canvas` is the long-lived branch for this repository's custom Canvas development.
- Merge direction is always `upstream/master` -> local `master` -> `feat/canvas`. Do not merge `feat/canvas` back into `master`.

## Remotes

- `upstream`: `https://github.com/daggerhashimoto/openclaw-nerve.git` (source repository; fetch only)
- `origin`: `https://github.com/MrToyy/openclaw-canvas.git` (personal fork; push local branches here)

Never push project-specific commits to `upstream`.

## Safe upstream sync procedure

Before changing branches, run `git status --short --branch`. The worktree must be clean. Preserve any existing user changes; do not discard, reset, or stash them without explicit approval.

```sh
git fetch --prune upstream origin
git switch master
git merge --ff-only upstream/master
git push origin master
git switch feat/canvas
git merge master
```

Resolve merge conflicts on `feat/canvas`, then run the relevant tests before pushing. Never resolve a non-fast-forward update on `master` by rebasing or force-pushing; investigate why it diverged first.

Push the development branch with:

```sh
# First push, if no tracking branch exists yet:
git push -u origin feat/canvas

# Later pushes:
git push
```

Do not force-push either protected workflow branch unless the user explicitly requests it.

## Current baseline (2026-07-20)

- Active branch: `feat/canvas`
- Worktree: clean before this file was added
- Local `master`, `feat/canvas`, `origin/master`, and `upstream/master`: `312e273`
- Local `master` tracks `upstream/master`
- Local `feat/canvas` has no upstream tracking branch yet

Remote-tracking references are only a local snapshot. Fetch before using this baseline to judge whether upstream has new commits.
