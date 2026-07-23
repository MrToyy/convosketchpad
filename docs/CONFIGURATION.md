# Configuration

Run `npm run setup` for the guided path. Copy `.env.example` only when configuring manually.

## Core

| Variable | Default | Meaning |
|---|---|---|
| `GATEWAY_URL` | `http://127.0.0.1:18789` | OpenClaw Gateway HTTP origin |
| `GATEWAY_TOKEN` | empty | Gateway Token used by server RPC and trusted WS injection |
| `PORT` | `3080` | HTTP port |
| `HOST` | `127.0.0.1` | Bind host |
| `SSL_PORT` | `3443` | Optional built-in TLS port when certificates exist |
| `NERVE_PUBLIC_ORIGIN` | empty | Browser-facing origin for Gateway handshakes |
| `OPENCLAW_CONFIG_PATH` | `~/.openclaw/openclaw.json` | Optional OpenClaw config override |

## Canvas storage and usage

| Variable | Default | Meaning |
|---|---|---|
| `NERVE_WORKSPACE_ROOT` | `~/.openclaw/workspace` | Default Agent workspace for attachment references |
| `NERVE_UPLOAD_STAGING_TEMP_DIR` | workspace `.temp/nerve-uploads` | Optional staging directory; must remain inside the workspace |
| `SESSIONS_DIR` | `~/.openclaw/agents/main/sessions` | Transcript usage-accounting source |
| `USAGE_FILE` | `~/.openclaw/token-usage.json` | Persistent usage totals |

Canvas SQLite and durable Artifacts intentionally use project-local `database/` and `artifacts/` paths.

## Managed authentication

| Variable | Default | Meaning |
|---|---|---|
| `NERVE_AUTH` | `false` | Enable managed-user login |
| `NERVE_SESSION_SECRET` | generated for the process if missing | Cookie signing secret; set it for restart-stable sessions |
| `NERVE_SESSION_TTL` | 30 days | Session lifetime in milliseconds |
| `NERVE_AUTH_MAX_FAILURES` | `3` | Failed logins allowed in the rolling window |
| `NERVE_AUTH_FAILURE_WINDOW` | 30 minutes | Failure window in milliseconds |
| `NERVE_AUTH_LOCKOUT` | 30 minutes | Lockout duration in milliseconds |

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
| `NERVE_ALLOW_INSECURE=true` | Explicitly allow `0.0.0.0` without managed auth; unsafe for normal use |
| `WS_ALLOWED_HOSTS` | Comma-separated extra Gateway target hosts |
| `ALLOWED_ORIGINS` | Comma-separated browser origins |
| `CSP_CONNECT_EXTRA` | Extra `connect-src` origins |
| `TRUSTED_PROXIES` | Reverse proxies whose forwarded client headers may be trusted |

ConvoSketchpad refuses `HOST=0.0.0.0` without authentication unless the insecure override is explicit. Prefer TLS and managed authentication for every non-local deployment.

## Removed settings

Voice, TTS/STT providers, API-key management, Memory paths, file-browser roots, and Agent display-name settings are no longer ConvoSketchpad configuration surfaces.
