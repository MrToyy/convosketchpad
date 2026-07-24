# Canvas code map

## Invariants

- Canvas is the only primary product surface.
- One Canvas owns one Agent and any number of Root/Fork Branches.
- Creation uses the Gateway default Agent; selection is editable until the first send is prepared.
- A Branch Session is created lazily on first input.
- Continue reuses a healthy Session; Fork, observed drift, and predicted reset recovery use a canonical snapshot.
- SQLite owns topology/state/layout; OpenClaw owns execution/transcripts.
- Attachments and Artifacts receive durable owner-scoped copies.

## Frontend

| Concern | Files |
|---|---|
| Canvas graph, nodes, Agent selector, event handling | `src/features/canvas/CanvasPanel.tsx` |
| REST client and contracts | `src/features/canvas/api.ts`, `src/features/canvas/types.ts` |
| Layout and tests | `src/features/canvas/layout.ts`, `layout.test.ts` |
| Attachment preparation | `src/features/canvas/attachments.ts`, `attachments.test.ts` |
| Localized Canvas copy | `src/features/canvas/messages.ts` |
| Gateway `chat.send` transport | `src/features/chat/operations/sendMessage.ts` |
| Gateway stream classification | `src/features/chat/operations/streamEventHandler.ts` |
| Shared image compression/lightbox | `src/features/chat/image-compress.ts`, `ImageLightbox.tsx` |
| Canvas-only shell | `src/App.tsx`, `src/components/TopBar.tsx`, `src/components/StatusBar.tsx` |

The residual `features/chat` path contains protocol/media primitives used by Canvas. It contains no Chat panel, input bar, history state, recovery context, or Session UI.

## Backend

| Concern | Files |
|---|---|
| Canvas HTTP API, Agent catalog validation | `server/routes/canvas.ts` |
| SQLite schema and Branch state machine | `server/lib/canvas-db.ts` |
| Reconciliation and Session drift | `server/lib/canvas-reconciler.ts` |
| Effective OpenClaw reset policy and timezone boundary prediction | `server/lib/openclaw-session-policy.ts` |
| Durable files | `server/lib/canvas-artifact-store.ts` |
| Upload staging and workspace path safety | `server/lib/upload-reference.ts`, `server/lib/file-utils.ts`, `server/lib/agent-workspace.ts` |
| Gateway server RPC, browser relay, and device-token boundary | `server/lib/gateway-rpc.ts`, `server/lib/ws-proxy.ts`, `server/lib/device-identity.ts` |
| Route mounting | `server/app.ts` |

## Agent flow

```text
POST Canvas {name}
  → agents.list → store defaultId
  → optional PATCH {agentId} while no reservation/Interaction exists
  → rewrite draft Branch session keys
  → prepare-send {expectedAgentId, ...}
  → Agent becomes locked
```

Tests: `server/lib/canvas-db.test.ts` covers transactional rewrite/lock behavior; Canvas route tests cover durable files; full behavior is exercised by `npm test -- --run`.

## Send flow

```text
stage files
  → prepare-send
  → inspect Session identity + effective reset policy
  → use canonical recovery snapshot if the send crosses daily/idle expiry
  → chat.send
  → ack(runId) + refresh actual Session ID
  → Gateway agent/chat events
  → reconcile transcript and Artifacts
  → completed Interaction + next composer
```

The Branch persists baseline and observed Session-start timestamps internally.
If policy inspection is unavailable, an active Branch takes the conservative
recovery path; previous Interactions and OpenClaw transcripts are never
rewritten.

## Documentation updates

Update this file when Canvas components move. Update `docs/ARCHITECTURE.md` when Agent, Branch, Interaction, attachment, Artifact, or recovery semantics change.
