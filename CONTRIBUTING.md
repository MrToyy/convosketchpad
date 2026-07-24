# Contributing to ConvoSketchpad

ConvoSketchpad is **A branching AI workspace for visual thinkers**. Contributions should strengthen the Canvas, its OpenClaw integration, or the security and operability needed to support that experience.

## Development setup

Requirements:

- Node.js 22.13 or newer
- npm
- A reachable OpenClaw Gateway

```bash
git clone https://github.com/<your-username>/convosketchpad.git
cd convosketchpad
npm install
npm run setup
```

Run the frontend and backend in separate terminals:

```bash
npm run dev
PORT=3081 npm run dev:server
```

Open `http://localhost:3080`. Vite proxies API and WebSocket traffic to the backend on port 3081.

## Project structure

```text
src/
  features/canvas/       Canvas graph, interactions, layout and files
  features/auth/         Managed login and authentication state
  features/connect/      Gateway connection UI
  features/settings/     Connection and appearance settings
  features/activity/     Log, event and usage observability
  features/chat/         Canvas-used Gateway protocol and media primitives
  components/            Shared product shell and UI components
  contexts/              Gateway and settings state
server/
  routes/                Canvas, auth, upload and operational HTTP routes
  lib/                   Persistence, reconciliation, Gateway and security logic
  middleware/            Auth, origin, rate-limit and response protections
bin/                     Update and managed-user CLIs
scripts/                 Setup wizard and installer helpers
config/                  TypeScript project configurations
docs/                    Product, operator and maintainer documentation
```

Start Canvas work with [the Canvas code map](docs/canvas/CANVAS-CODE-MAP.md), authentication work with [the Auth code map](docs/canvas/AUTH-CODE-MAP.md), and Git operations with [the Git workflow](docs/canvas/GIT-WORKFLOW.md).

## Implementation expectations

- Keep feature code close to the existing subsystem and avoid parallel abstractions.
- Treat Canvas topology, Branch heads, prepared sends, owner boundaries and durable files as data-integrity constraints.
- Keep OpenClaw protocol names such as `chat.send` intact; these are transport contracts, not product surfaces.
- Validate write inputs, preserve authentication and origin checks, and use existing Gateway helpers.
- Clean up timers, listeners, sockets and observers in frontend work.
- Update `.env.example` and `docs/CONFIGURATION.md` together when adding configuration.
- Update the relevant code map when moving or renaming Canvas or Auth components.
- Update `docs/PRODUCT.md` or `docs/ARCHITECTURE.md` when product or data-flow semantics change.

Review in this order: correctness, security and isolation, consistency with the surrounding subsystem, tests and operability, then style.

## Tests and checks

Vitest uses a Node environment for `server/` and `scripts/`, and jsdom for `src/`.

```bash
npm test -- --run
npm run lint
npm run build
```

Add focused tests beside changed code. Do not weaken assertions merely to make a change pass.

## Git and pull requests

- Create feature branches from `main` and open pull requests into `main`.
- `master` is the clean upstream mirror and must not contain ConvoSketchpad product commits.
- Keep each pull request focused and include regression tests when practical.
- Use Conventional Commits, for example:

```text
feat(canvas): add branch filter controls
fix(auth): revoke sockets after token rotation
docs: clarify remote gateway deployment
```

Before requesting review, confirm the full test, lint and build commands above pass.

## License

Contributions are licensed under the [MIT License](LICENSE).
