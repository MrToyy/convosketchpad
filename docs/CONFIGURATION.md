# Configuration

Run `npm run setup` for the guided path. Copy `.env.example` only when configuring manually.

## Core

| Variable | Default | Meaning |
|---|---|---|
| `GATEWAY_URL` | `http://127.0.0.1:18789` | OpenClaw Gateway HTTP origin |
| `GATEWAY_TOKEN` | empty | Gateway Token used by server RPC and trusted WS injection |
| `CONVOSKETCHPAD_GATEWAY_TIMEZONE` | application host timezone | IANA timezone used by the Gateway for daily Session resets; set this for a remote Gateway |
| `PORT` | `3080` | HTTP port |
| `HOST` | `127.0.0.1` | Bind host |
| `SSL_PORT` | `3443` | Optional built-in TLS port when certificates exist |
| `CONVOSKETCHPAD_PUBLIC_ORIGIN` | empty | Browser-facing origin for Gateway handshakes |
| `OPENCLAW_CONFIG_PATH` | unset | Optional OpenClaw CLI instance selector; ConvoSketchpad passes it through but never opens the file |

`CONVOSKETCHPAD_GATEWAY_TIMEZONE` must be an IANA name such as `Asia/Shanghai` or
`America/New_York`. An invalid explicit value stops startup, because using the
wrong timezone could make Canvas miss the first recovery send after OpenClaw's
daily reset.

In development, `npm run dev` starts both processes and exposes a single browser
entrypoint on `VITE_PORT` (default `3080`). The watch-mode server uses the
configured `PORT` when it differs from the frontend port; otherwise it uses the
next port (default `3081`). Vite proxies `/api`, `/health`, and `/ws` to it.
Client changes use Vite HMR. Server changes restart the server process
automatically, so in-memory state and active WebSocket connections are
recreated.

## OpenClaw-owned Gateway setup

ConvoSketchpad needs no OpenClaw tool allowlist or admin scope. For a browser
origin outside the Gateway's loopback defaults, the only OpenClaw config value
it changes is:

```text
gateway.controlUi.allowedOrigins
```

`npm run setup` reads that value with `openclaw config get`, merges the required
origins, validates the full change with `openclaw config patch --dry-run`, and
then applies it with `openclaw config patch`. Gateway port and token discovery
also use `openclaw config get`. ConvoSketchpad never reads or writes
`openclaw.json`, `devices/paired.json`, or `identity/device-auth.json`
directly.

Device enrollment uses OpenClaw's native pending-request flow:

```bash
openclaw devices list --json
openclaw devices approve <requestId>
```

Interactive setup shows the exact matched request and asks before approval.
`--defaults` creates/checks the pending request but leaves approval to the
operator. ConvoSketchpad requests only `operator.read` and `operator.write`.

For a remote Gateway, setup does not mutate a local OpenClaw config. Run the
printed `openclaw config` and `openclaw devices` commands on the Gateway host.

After approval, OpenClaw's returned device token is stored in
`$CONVOSKETCHPAD_DATA_DIR/gateway-auth.json` (default `~/.convosketchpad/gateway-auth.json`) with
mode `0600`, keyed by Gateway URL. The server removes device-token fields from
the connect response before forwarding it to the browser.

## ConvoSketchpad-owned storage

| Variable | Default | Meaning |
|---|---|---|
| `CONVOSKETCHPAD_DATA_DIR` | `~/.convosketchpad` | Device identity, Gateway device Tokens, and updater state |

Canvas SQLite and durable Artifacts intentionally use project-local `database/` and `artifacts/` paths.
Uploads are persisted there before `chat.send`; core usage totals come from
OpenClaw `usage.cost`, and Provider quota windows come from `usage.status`.
Provider and message details refresh opportunistically from `sessions.usage`
and do not make the usage endpoint unavailable when that slower query fails.
ConvoSketchpad does not inspect Codex or Claude local credentials or invoke
their CLIs. The retired workspace/session/usage path variables are ignored with
a startup warning.

## Managed authentication

| Variable | Default | Meaning |
|---|---|---|
| `CONVOSKETCHPAD_AUTH` | `false` | Enable managed-user login |
| `CONVOSKETCHPAD_SESSION_SECRET` | generated for the process if missing | Cookie signing secret; set it for restart-stable sessions |
| `CONVOSKETCHPAD_SESSION_TTL` | 30 days | Session lifetime in milliseconds |
| `CONVOSKETCHPAD_AUTH_MAX_FAILURES` | `3` | Failed logins allowed in the rolling window |
| `CONVOSKETCHPAD_AUTH_FAILURE_WINDOW` | 30 minutes | Failure window in milliseconds |
| `CONVOSKETCHPAD_AUTH_LOCKOUT` | 30 minutes | Lockout duration in milliseconds |

User management:

```bash
npm run users -- add <name> [--token <token>]
npm run users -- list
npm run users -- rotate <name> [--token <token>]
npm run users -- disable <name>
npm run users -- enable <name>
```

## Network policy

| Variable | Meaning |
|---|---|
| `CONVOSKETCHPAD_ALLOW_INSECURE=true` | Explicitly allow `0.0.0.0` without managed auth; unsafe for normal use |
| `WS_ALLOWED_HOSTS` | Comma-separated extra Gateway target hosts |
| `ALLOWED_ORIGINS` | Comma-separated browser origins |
| `CSP_CONNECT_EXTRA` | Extra `connect-src` origins |
| `TRUSTED_PROXIES` | Reverse proxies whose forwarded client headers may be trusted |

ConvoSketchpad refuses `HOST=0.0.0.0` without authentication unless the insecure override is explicit. Prefer TLS and managed authentication for every non-local deployment.
