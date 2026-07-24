# ConvoSketchpad runtime and data flow

This document replaces the inherited Nerve multi-panel runtime description. ConvoSketchpad now keeps only the infrastructure required by its Canvas.

## Process model

The browser loads the React SPA from the Hono server. It maintains a WebSocket connection to OpenClaw through `server/lib/ws-proxy.ts`, and uses owner-scoped HTTP routes for Canvas state and files. The server also keeps a persistent RPC connection to OpenClaw for Agent discovery, Session inspection, and transcript reconciliation.

Both Gateway connections use the same persistent ConvoSketchpad device
identity and the exact `operator.read` / `operator.write` scope set. OpenClaw
owns pairing approval. The returned device token is persisted only on the
server and is removed from the hello response relayed to the browser.

```text
Browser Canvas
  ├─ RPC over WebSocket → WS proxy → OpenClaw Gateway
  └─ REST → Hono routes
              ├─ SQLite CanvasStore
              ├─ durable Artifact store
              └─ Gateway RPC reconciler → OpenClaw transcript
```

## Canvas creation and Agent selection

1. Browser sends `POST /api/canvas/canvases` with a name only.
2. Server calls Gateway `agents.list` and persists `defaultId`.
3. The empty Canvas creates a draft root Branch with no OpenClaw Session.
4. Before any send reservation or Interaction exists, the user may choose another listed Agent.
5. The server changes the Canvas Agent and rewrites every draft Branch key to `agent:<agentId>:canvas:<branchId>` in one transaction.
6. Once a send is prepared, Agent selection is locked.

## Interaction send

1. Browser stages selected files in the Canvas Agent workspace.
2. `prepare-send` verifies owner, Branch head, `expectedAgentId`, and send exclusivity.
3. The server copies attachments into the owner-scoped Canvas store, reads the effective OpenClaw Session reset policy, and records a prepared reservation. If the next send is at or beyond a daily/idle reset boundary, the reservation carries a canonical recovery snapshot.
4. Browser invokes OpenClaw `chat.send` with the stable Branch session key.
5. Browser acknowledges the reservation with the returned `runId`; the server refreshes the actual Session ID before inserting the Interaction and activating or rebasing the Branch.
6. Gateway `agent` and `chat` events update the live Canvas UI.
7. A terminal event schedules reconciliation; the server reads the authoritative transcript, persists output and Artifacts, and completes the Interaction.

Prepared reservations prevent changing the Agent during the gap between validation and Gateway acceptance. A stale browser that submits a previous Agent receives `409 agent_changed`.

## Continue and Fork

- Continue uses the same Branch session key and requires the expected head Interaction ID.
- Fork is allowed only from a completed historical Interaction, not the current head.
- A Fork Branch stays draft until its first real send.
- The Fork's first message contains an immutable canonical snapshot and references to reusable ancestor resources.
- Healthy Continue does not replay prior history.

## Session integrity

ConvoSketchpad treats a Branch session key as stable but observes the OpenClaw `sessionId` and stores internal baseline/observed Session-start timestamps. Before continuing an active Branch, it calls `sessions.list` and reads `config.get` through a short-lived cache:

- same Session: continue normally;
- replacement Session: mark drifted and inject the canonical snapshot on the next send;
- missing Session: mark drifted and recover on the next send.
- same Session but daily/idle expiry is due: proactively inject the canonical snapshot on this send, before OpenClaw replaces the Session.
- reset policy unavailable: conservatively use recovery materialization instead of risking a context-free send.

Daily boundaries use `NERVE_GATEWAY_TIMEZONE`, which defaults to the
ConvoSketchpad host timezone and must be set explicitly when a remote Gateway
uses another timezone. After `chat.send`, acknowledgement refreshes
`sessions.list` so a replacement Session becomes the new healthy baseline.
This recovery changes neither previous Interactions nor the original OpenClaw
transcript.

## Persistence

| Data | Owner |
|---|---|
| Agents, tools, execution, Sessions, transcripts | OpenClaw |
| Device pairing approval and paired-device records | OpenClaw |
| ConvoSketchpad device key and per-Gateway device tokens | `~/.nerve/device-identity.json`, `~/.nerve/gateway-auth.json` |
| Canvas, Branch, Interaction, reservation, layout, managed users | `database/canvas.sqlite` |
| Durable user attachments and generated Artifacts | `artifacts/` |
| Temporary tool-readable upload staging | selected Agent workspace |
| Small UI activity log | `agent-log.json` |

The Canvas database and Artifact directory must be backed up and restored together.

## Removed runtime paths

There is no Chat context/history loader, Session browser, Tasks service, Memory watcher/API, workspace file editor, Skills/Cron UI, SSE event bus, audio pipeline, TTS provider, STT model, or voice command runtime.
