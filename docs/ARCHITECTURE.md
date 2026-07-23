# Architecture

## Product boundary

ConvoSketchpad exposes one primary surface: a visual Canvas for branching OpenClaw interactions. It does not expose a general Chat view, Tasks/Kanban, Session browser, workspace editor, Memory, Skills, Cron, command palette, voice input, STT, or TTS.

The word `chat` still appears in a few low-level files because `chat.send` and `chat` events are native OpenClaw Gateway protocol names. Those helpers are used exclusively by Canvas interactions.

## Runtime

```text
Browser
  ├─ React Flow Canvas
  ├─ Gateway WebSocket: agents.list, sessions.list, chat.send, agent/chat events
  └─ HTTP API
       └─ Hono server
            ├─ CanvasStore (SQLite)
            ├─ artifact/attachment store
            ├─ managed-user authentication
            ├─ Gateway RPC and WS proxy
            └─ transcript reconciliation
```

OpenClaw owns Agents, execution, tools, Sessions, streaming events, and transcripts. ConvoSketchpad owns Canvas/Branch/Interaction relationships, layout, send reservations, session-integrity observations, managed users, and durable files.

## Frontend

| Area | Entry point |
|---|---|
| App shell and telemetry drawers | `src/App.tsx`, `src/components/TopBar.tsx`, `src/components/StatusBar.tsx` |
| Canvas graph and interaction lifecycle | `src/features/canvas/CanvasPanel.tsx` |
| Canvas REST client and contracts | `src/features/canvas/api.ts`, `src/features/canvas/types.ts` |
| Attachment preparation | `src/features/canvas/attachments.ts` |
| OpenClaw send/event primitives | `src/features/chat/operations/` |
| Connection and WebSocket | `src/contexts/GatewayContext.tsx`, `src/hooks/useWebSocket.ts` |
| Managed login | `src/features/auth/` |
| Appearance/connection settings | `src/features/settings/` |

The remaining `src/features/chat/` files are shared Canvas runtime primitives: `chat.send` transport, Gateway event classification, upload descriptors, image compression, and image lightbox. There is no Chat UI or Chat state context.

## Backend

| Area | Entry point |
|---|---|
| Route assembly | `server/app.ts` |
| Canvas API | `server/routes/canvas.ts` |
| Canvas schema and state machine | `server/lib/canvas-db.ts` |
| Transcript/artifact reconciliation | `server/lib/canvas-reconciler.ts` |
| Durable files | `server/lib/canvas-artifact-store.ts` |
| Upload staging | `server/routes/upload-reference.ts`, `server/lib/upload-reference.ts` |
| Gateway server-side RPC | `server/lib/gateway-rpc.ts` |
| Browser WS relay | `server/lib/ws-proxy.ts` |
| Managed users | `server/routes/auth.ts`, `server/lib/managed-users.ts` |

Runtime data lives in `database/canvas.sqlite`, `artifacts/`, and `agent-log.json`. These paths are project-local and ignored by Git.

## Agent lifecycle

Creating a Canvas accepts only a name. The server calls `agents.list` and stores the Gateway's `defaultId`. Before the first Interaction, the user may select another valid Agent; changing it rewrites every draft Branch session key. A prepared send or any existing Interaction locks the Agent. `prepare-send` also requires `expectedAgentId`, preventing a stale browser from sending through the wrong Agent.

## Send and recovery flow

```text
Composer
  → stage attachments
  → prepare-send (validate owner, head, expected Agent; persist files)
  → Gateway chat.send
  → acknowledge reservation with runId
  → consume agent/chat events
  → reconcile final transcript and artifacts
  → persist completed Interaction
```

Healthy Branches continue their existing Session without replaying history. If the stable session key points to a replacement Session, or the Session disappears, the next send includes an immutable canonical snapshot through the Branch head.

## Validation

```bash
npm test -- --run
npx tsc --noEmit -p config/tsconfig.app.json
npx tsc --noEmit -p config/tsconfig.server.json
npm run build
```
