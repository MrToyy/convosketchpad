# Deployment: remote browser access

The recommended topology runs ConvoSketchpad and OpenClaw on the same server:

```text
Remote browser → HTTPS reverse proxy → ConvoSketchpad → local OpenClaw Gateway
```

## Requirements

- `HOST=0.0.0.0`
- `NERVE_AUTH=true`
- a stable random `NERVE_SESSION_SECRET`
- HTTPS through Caddy, Nginx, Traefik, Tailscale Serve, or equivalent
- correct `TRUSTED_PROXIES` when a reverse proxy supplies client IP headers
- the public origin in `ALLOWED_ORIGINS`, `NERVE_PUBLIC_ORIGIN`, and the Gateway's `controlUi.allowedOrigins`

Keep the Gateway on loopback where possible:

```bash
GATEWAY_URL=http://127.0.0.1:18789
```

## Setup

```bash
cd ~/convosketchpad
npm run setup
npm run users -- add <name>
sudo systemctl restart nerve.service
```

Back up `database/canvas.sqlite` and `artifacts/` together.

## Split-host variant

Running ConvoSketchpad and OpenClaw on different servers is supported for Gateway traffic, but local workspace paths may not be meaningful to the remote Agent. See [Deployment B](DEPLOYMENT-B.md) and prefer a shared filesystem or same-host deployment when Canvas attachments and generated local Artifacts matter.

## Validate

```bash
curl -sS http://127.0.0.1:3080/health
curl -sS https://canvas.example.com/health
```

Verify login, Gateway connection, Agent discovery, Canvas creation, text send, attachment send, Fork, and Artifact download.
