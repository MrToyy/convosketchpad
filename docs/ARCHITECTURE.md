# Architecture and runtime data flow

ConvoSketchpad provides a visual Canvas for branching OpenClaw interactions. Its supporting surfaces cover connection, authentication, appearance, Gateway restart, and compact log, event, and usage observability.

## Ownership boundary

OpenClaw owns Agents, tools, execution, Sessions, streaming events, and transcripts. ConvoSketchpad owns Canvas, Branch, and Interaction relationships; layout; send reservations; session-integrity observations; managed users; and durable attachments and Artifacts.

Low-level code retains OpenClaw protocol names such as `chat.send` and `chat` events where those names are part of the Gateway contract.

## Process model

```text
Browser
  ├─ React Flow Canvas
  ├─ RPC over WebSocket → ConvoSketchpad WS proxy → OpenClaw Gateway
  └─ owner-scoped HTTP API → Hono server
                               ├─ CanvasStore (SQLite)
                               ├─ attachment and Artifact store
                               ├─ managed-user authentication
                               └─ Gateway RPC reconciler → OpenClaw transcript
```

The browser loads the React SPA from the Hono server. It connects to OpenClaw through the server WebSocket relay and uses HTTP routes for Canvas state and files. The server also maintains Gateway RPC access for Agent discovery, Session inspection, reset-policy reads, and transcript reconciliation.

Both Gateway paths use the same persistent ConvoSketchpad device identity and the exact `operator.read` / `operator.write` scopes. OpenClaw owns pairing approval. Device Tokens remain on the server and are removed from the Gateway hello response before it reaches the browser.

## Product model

```text
Canvas (one selected Agent)
  ├─ Root Branch
  │    ├─ Interaction → Interaction → Interaction
  │    └─ Fork Branch from a historical Interaction
  └─ Root Branch
```

- A Canvas is an owner-scoped visual workspace bound to one OpenClaw Agent.
- A Branch maps to one stable OpenClaw Session key.
- An Interaction is one complete user input and Agent output turn.
- A Root Branch begins without inherited context.
- A Fork Branch begins from an immutable snapshot through its source Interaction.
- Layout persists independently from transcript data.

### Branch invariants

1. A Branch has at most one head Interaction.
2. Continue requires the caller's expected head to match the stored head.
3. Only one prepared send may exist for a Branch.
4. A completed historical Interaction may be forked; the current head may not.
5. Draft Root and Fork composers are deduplicated.
6. Interactions are append-only from the user's perspective.
7. OpenClaw Sessions are created lazily on the first real send.
8. Session recovery never rewrites earlier Canvas data or OpenClaw transcripts.

## Frontend

| Area | Entry point |
|---|---|
| App shell and telemetry drawers | `src/App.tsx`, `src/components/TopBar.tsx`, `src/components/StatusBar.tsx` |
| Canvas graph and Interaction lifecycle | `src/features/canvas/CanvasPanel.tsx` |
| Canvas REST client and contracts | `src/features/canvas/api.ts`, `src/features/canvas/types.ts` |
| Attachment preparation | `src/features/canvas/attachments.ts` |
| OpenClaw send and event primitives | `src/features/chat/operations/` |
| Connection and WebSocket | `src/contexts/GatewayContext.tsx`, `src/hooks/useWebSocket.ts` |
| Managed login | `src/features/auth/` |
| Appearance and connection settings | `src/features/settings/` |

The remaining `src/features/chat/` modules are Canvas runtime primitives for Gateway transport, event classification, upload descriptors, image compression, and image display.

## Backend

| Area | Entry point |
|---|---|
| Route assembly | `server/app.ts` |
| Canvas API | `server/routes/canvas.ts` |
| Canvas schema and state machine | `server/lib/canvas-db.ts` |
| Transcript and Artifact reconciliation | `server/lib/canvas-reconciler.ts` |
| Durable files | `server/lib/canvas-artifact-store.ts` |
| Upload staging | `server/routes/upload-reference.ts`, `server/lib/upload-reference.ts` |
| Gateway server-side RPC | `server/lib/gateway-rpc.ts` |
| Browser WebSocket relay | `server/lib/ws-proxy.ts` |
| Managed users | `server/routes/auth.ts`, `server/lib/managed-users.ts` |

## Canvas creation and Agent selection

1. The browser sends `POST /api/canvas/canvases` with a name.
2. The server calls `agents.list` and stores the Gateway's `defaultId`.
3. The empty Canvas creates a draft Root Branch without an OpenClaw Session.
4. Before any reservation or Interaction exists, the user may select another listed Agent.
5. The server updates the Canvas and rewrites every draft Branch key to `agent:<agentId>:canvas:<branchId>` in one transaction.
6. Preparing the first send locks Agent selection.

Every prepare request carries `expectedAgentId`; stale requests fail instead of routing work through a different Agent.

## Send flow

```text
stage attachments
  → prepare-send (owner, head, Agent and exclusivity checks)
  → inspect Session identity and effective reset policy
  → persist durable files and reservation
  → Gateway chat.send
  → acknowledge reservation with runId and current Session ID
  → consume agent/chat events
  → reconcile authoritative transcript and Artifacts
  → persist completed Interaction
```

Healthy Branches continue their existing Session without replaying history. A Fork's first send carries an immutable canonical snapshot and references to reusable ancestor resources.

## Session integrity and recovery

ConvoSketchpad treats a Branch Session key as stable while observing the actual OpenClaw `sessionId` and Session-start timestamps.

- Same Session: continue normally.
- Replaced or missing Session: mark the Branch drifted and include the canonical snapshot on the next send.
- Daily or idle reset due: include the snapshot proactively before OpenClaw replaces the Session.
- Reset policy unavailable: use recovery materialization conservatively.

Daily boundaries use `CONVOSKETCHPAD_GATEWAY_TIMEZONE`. It defaults to the ConvoSketchpad host timezone and must be set explicitly when a remote Gateway uses another timezone.

## Attachments, Artifacts, and reconciliation

Workspace staging makes an upload readable to OpenClaw tools for the current send. Before committing the Interaction, ConvoSketchpad creates an owner-scoped durable copy. Forks therefore do not depend on the original workspace file.

Generated local/data resources and tool outputs are materialized into the Canvas Artifact store when possible. External HTTP(S) resources remain references. A missing Artifact degrades the file result without erasing a successful text response.

Gateway terminal events are completion hints. The reconciler reads the authoritative transcript, persists output and Artifacts, and retries unfinished or degraded records after restart and when a Canvas loads.

## Persistence

| Data | Owner |
|---|---|
| Agents, tools, execution, Sessions, transcripts | OpenClaw |
| Pairing approval and paired-device records | OpenClaw |
| ConvoSketchpad device key and per-Gateway device Tokens | `~/.convosketchpad/device-identity.json`, `~/.convosketchpad/gateway-auth.json` |
| Canvas, Branch, Interaction, reservation, layout, managed users | `database/canvas.sqlite` |
| Durable attachments and Artifacts | `artifacts/` |
| Temporary tool-readable upload staging | Selected Agent workspace |
| Compact activity log | `agent-log.json` |

Back up and restore `database/canvas.sqlite` and `artifacts/` together.

## Validation

```bash
npm test -- --run
npm run lint
npm run build
```
