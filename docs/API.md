# HTTP API

All `/api/*` routes are subject to the common body limit, security headers, rate limiting where declared, and managed-user middleware. With `NERVE_AUTH=true`, clients authenticate using the HttpOnly session Cookie returned by login.

## Canvas

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/canvas/canvases` | List the current owner's Canvases |
| POST | `/api/canvas/canvases` | Create from `{ name }`; server selects Gateway default Agent |
| PATCH | `/api/canvas/canvases/:id` | Update `name` and/or pre-first-send `agentId` |
| DELETE | `/api/canvas/canvases/:id` | Delete Canvas records and durable files |
| GET | `/api/canvas/canvases/:id/graph` | Read Canvas, Branches, Interactions, and layout |
| PUT | `/api/canvas/canvases/:id/layout` | Save node positions and viewport |
| POST | `/api/canvas/canvases/:id/root-branches` | Create or return the unresolved root composer |
| POST | `/api/canvas/interactions/:id/fork` | Fork a completed historical Interaction |
| POST | `/api/canvas/branches/:id/prepare-send` | Reserve a send and persist attachments |
| POST | `/api/canvas/send-reservations/:id/ack` | Materialize the Interaction after Gateway acceptance |
| POST | `/api/canvas/send-reservations/:id/fail` | Mark an unacknowledged reservation failed |
| POST | `/api/canvas/interactions/:id/complete` | Compatibility completion hint |
| POST | `/api/canvas/interactions/:id/reconcile` | Schedule transcript/artifact reconciliation |

`prepare-send` requires `expectedAgentId`, `userInput`, optional `expectedHeadInteractionId`, and up to four attachments. Agent mismatch returns `409 agent_changed`; changing an already-used Canvas Agent returns `409 agent_locked`.

## Canvas files

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/canvas/attachments/:canvasId/:attachmentId` | Read an owner-scoped durable attachment |
| GET | `/api/canvas/artifacts/:canvasId/:interactionId/:artifactId` | Read an owner-scoped durable Artifact |
| GET | `/api/canvas/send-reservations/:id/resources/:resourceId` | Read a canonical Fork bootstrap resource |
| GET | `/api/canvas/openclaw-artifact?uri=...` | Proxy an owned OpenClaw media Artifact |
| POST | `/api/upload-reference/resolve` | Stage owner/Agent-validated multipart Canvas uploads |
| GET | `/api/files?path=...` | Serve an allowlisted local image path |

## Authentication

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Exchange a managed user Token for a signed Cookie |
| POST | `/api/auth/logout` | Clear the Cookie |
| GET | `/api/auth/status` | Return the current authentication state |

Users are administered locally with `npm run users -- ...`; there is no registration API.

## Runtime and telemetry

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Process health |
| GET/POST | `/api/agentlog` | Read or append the bounded Canvas activity log |
| GET | `/api/tokens` | Usage totals used by the top bar |
| GET | `/api/server-info` | Server clock, timezone, and Gateway uptime |
| GET | `/api/codex-limits` | Local Codex usage-limit metadata |
| GET | `/api/claude-code-limits` | Local Claude Code usage-limit metadata |
| GET | `/api/version` | Installed version |
| GET | `/api/version/check` | Check the official stable Release in local mode; returns `disabled` under managed authentication |
| GET | `/api/connect-defaults` | Browser Gateway connection defaults |
| POST | `/api/gateway/restart` | Restart the local OpenClaw Gateway |

Removed Nerve endpoints for Chat history, Sessions, Tasks, Memory, workspace files, Skills, Cron, voice, transcription, and speech are intentionally not mounted and return 404.
