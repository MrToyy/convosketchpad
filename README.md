<div align="center">

# ConvoSketchpad

**A branching AI workspace for visual thinkers**

[![GitHub stars](https://img.shields.io/github/stars/MrToyy/convosketchpad?style=for-the-badge&logo=github&label=Star%20ConvoSketchpad&color=0f172a)](https://github.com/MrToyy/convosketchpad)
[![MIT License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

</div>

ConvoSketchpad turns AI work into a spatial graph. Start independent directions, continue a branch, or fork any completed interaction while keeping prompts, outputs, attachments, and generated artifacts together.

## What it does

- Multiple root branches on one pan-and-zoom Canvas.
- Append-only interactions with explicit Continue and Fork semantics.
- One OpenClaw Agent per Canvas.
- New Canvases use the Gateway's default Agent automatically.
- The Agent may be changed until the first send begins; it is locked once a send is prepared.
- Durable, owner-scoped copies of user attachments and generated artifacts.
- Canonical snapshot recovery when OpenClaw replaces or removes a Branch Session.
- Optional managed-user authentication and Canvas isolation.

```text
Canvas
├── Root A: Interaction 1 ── Interaction 2 ── Interaction 3
│                                  └────────── Fork B
└── Root C: Interaction 4 ── Interaction 5
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/MrToyy/convosketchpad/main/install.sh | bash
```

Manual setup:

```bash
git clone https://github.com/MrToyy/convosketchpad.git
cd convosketchpad
npm install
npm run setup
npm run prod
```

Development:

```bash
npm run dev
PORT=3081 npm run dev:server
```

Node.js 22.13+ and a reachable OpenClaw Gateway are required.

## Architecture

```text
React Canvas ── WebSocket ── OpenClaw Gateway (agents, execution, transcripts)
      │
      └──────── HTTP ─────── ConvoSketchpad server ── SQLite + artifact store
```

OpenClaw owns Agent execution and Session transcripts. ConvoSketchpad owns Canvas topology, layout, send reservations, recovery metadata, user isolation, and durable attachment and Artifact copies.

## Documentation

- [Product goal](docs/PRODUCT.md)
- [Documentation index](docs/README.md)
- [Feature index](docs/canvas/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Installation](docs/INSTALL.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Configuration](docs/CONFIGURATION.md)
- [Security](docs/SECURITY.md)
- [Git workflow](docs/canvas/GIT-WORKFLOW.md)

## Upstream and license

ConvoSketchpad is derived from [OpenClaw Nerve](https://github.com/daggerhashimoto/openclaw-nerve), retains its MIT license and Git history, and is independently maintained.

[MIT](LICENSE)
