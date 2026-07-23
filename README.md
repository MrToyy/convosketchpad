<div align="center">

# ConvoSketchpad

**A branching AI workspace for visual thinkers.**

Explore OpenClaw conversations as a spatial graph, fork any completed interaction,
and keep prompts, outputs, attachments, and artifacts together on one persistent canvas.

[![GitHub stars](https://img.shields.io/github/stars/MrToyy/convosketchpad?style=for-the-badge&logo=github&label=Star%20ConvoSketchpad&color=0f172a)](https://github.com/MrToyy/convosketchpad)
[![MIT License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

</div>

## Why ConvoSketchpad

Linear chat is useful for reaching one answer. Creative work rarely follows one line.
Designers and other visual thinkers compare directions, return to earlier decisions,
reuse references, and develop several alternatives at once.

ConvoSketchpad turns those alternatives into a navigable workspace:

- start multiple independent conversations on one canvas;
- continue a direction without replaying healthy session history;
- fork any completed interaction into a new OpenClaw session;
- arrange branches and outputs on a pan-and-zoom graph;
- attach images and files and retain stable, workspace-owned copies;
- preserve generated artifacts beside the interaction that produced them;
- isolate canvases and artifacts by managed user when authentication is enabled.

The Canvas is an additional interaction model. Existing Nerve chat, tasks, workspace,
voice, telemetry, and agent controls remain available.

## Install

### One command

```bash
curl -fsSL https://raw.githubusercontent.com/MrToyy/convosketchpad/main/install.sh | bash
```

The installer checks dependencies, clones the repository, builds the application,
and starts the guided OpenClaw gateway setup.

### Manual setup

```bash
git clone https://github.com/MrToyy/convosketchpad.git
cd convosketchpad
npm install
npm run setup
npm run prod
```

For development:

```bash
npm run dev
PORT=3081 npm run dev:server
```

Node.js 22.13 or newer and an OpenClaw gateway are required.

## Product model

```text
Canvas
├── Root branch A: Interaction 1 ── Interaction 2 ── Interaction 3
│                                            └────── Fork branch B
└── Root branch C: Interaction 4 ── Interaction 5
```

An interaction represents one complete user input → agent output run, including its
attachments, tool activity, generated artifacts, and OpenClaw session metadata.
Historical interactions are append-only. Forking creates a new session and leaves the
source branch unchanged.

## Architecture

ConvoSketchpad builds on OpenClaw Nerve and continues to use the OpenClaw gateway for
agents, sessions, tools, streaming, transcripts, compaction, and workspace access.
The project adds its own Canvas domain, persistent graph layout, managed-user
authentication, artifact store, and session-recovery layer.

```text
Browser / React Flow
       │
       ├── WebSocket ── OpenClaw Gateway
       └── HTTP API ── ConvoSketchpad server ── SQLite + artifact store
```

The `main` branch contains the ConvoSketchpad product. The `master` branch remains a
clean mirror of `upstream/master`; upstream changes flow from `master` into `main`.
See [the Git workflow](docs/canvas/GIT-WORKFLOW.md) before synchronizing or publishing.

## Documentation

- [Canvas feature index](docs/canvas/README.md)
- [Canvas code map](docs/canvas/CANVAS-CODE-MAP.md)
- [Authentication code map](docs/canvas/AUTH-CODE-MAP.md)
- [Canvas MVP design](docs/OPENCLAW-CANVAS-MVP-DESIGN.md)
- [Configuration](docs/CONFIGURATION.md)
- [Security](docs/SECURITY.md)
- [API reference](docs/API.md)
- [Contributing](CONTRIBUTING.md)

## Upstream and attribution

ConvoSketchpad is derived from
[OpenClaw Nerve](https://github.com/daggerhashimoto/openclaw-nerve) and retains its
MIT license and Git history. Nerve remains the upstream source for the underlying
OpenClaw web interface; ConvoSketchpad independently maintains the Canvas,
branching-interaction, artifact, and managed-user experience.

## License

[MIT](LICENSE)
