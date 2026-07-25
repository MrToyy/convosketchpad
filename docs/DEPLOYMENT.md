# Deployment

Choose a topology based on where the browser, ConvoSketchpad server, and OpenClaw Gateway run. Start with the same-machine topology when possible.

## Local same machine

```text
Browser (localhost) → ConvoSketchpad (127.0.0.1:3080) → Gateway (127.0.0.1:18789)
```

This is the default topology and has the fewest moving parts.

```bash
curl -fsSL https://raw.githubusercontent.com/MrToyy/convosketchpad/main/install.sh | bash
cd ~/convosketchpad
npm run setup
```

Recommended setup choices:

- Access mode: **This machine only (localhost)**
- Authentication: optional for localhost-only access

Restart a managed service or run directly:

```bash
sudo systemctl restart convosketchpad.service
# or
npm run prod
```

Validate:

```bash
openclaw gateway status
curl -fsS http://127.0.0.1:18789/health
curl -fsS http://127.0.0.1:3080/health
```

If Gateway authentication or device scopes become stale, rerun `npm run setup`. It uses OpenClaw's native device flow. Inspect and approve the exact request when manual approval is needed:

```bash
openclaw devices list --json
openclaw devices approve <requestId>
```

If the browser retains a manually entered stale Gateway Token, clear site data or remove `localStorage.oc-config`.

## Local UI with a remote Gateway

```text
Browser (localhost) → ConvoSketchpad local → private network → OpenClaw Gateway remote
```

Use Tailscale, WireGuard, or an SSH tunnel. Avoid exposing the Gateway port publicly.

Configure the local ConvoSketchpad host:

```bash
GATEWAY_URL=https://gateway.example.internal
GATEWAY_TOKEN=<token>
CONVOSKETCHPAD_GATEWAY_TIMEZONE=Asia/Shanghai
WS_ALLOWED_HOSTS=gateway.example.internal
```

Set `CONVOSKETCHPAD_GATEWAY_TIMEZONE` to the Gateway host timezone. Canvas uses it with OpenClaw's effective daily and idle reset policy to recover context on the first send after a reset.

On the Gateway host, inspect and merge the browser-facing ConvoSketchpad origins:

```bash
openclaw config get gateway.controlUi.allowedOrigins --json
openclaw config patch --file ./convosketchpad-origin.patch.json5 --dry-run
openclaw config patch --file ./convosketchpad-origin.patch.json5
```

Example patch shape:

```json5
{
  gateway: {
    controlUi: {
      allowedOrigins: [
        "http://localhost:3080",
        "http://127.0.0.1:3080",
        // Preserve existing entries.
      ],
    },
  },
}
```

Pair the ConvoSketchpad device on that host with `openclaw devices list --json` and `openclaw devices approve <requestId>`. Local setup does not write the remote host's configuration.

Canvas execution, events, Branch/Fork behavior, uploads, native Artifact
download, and usage work through the Gateway. A remote deployment needs no
shared workspace for uploads. Legacy absolute-path Artifacts can only be
recovered when the returned path exists on the ConvoSketchpad host and belongs
to a workspace root reported by the Gateway; otherwise they degrade explicitly.

Validate both health endpoints, then test Agent discovery, a text Interaction, and an attachment appropriate to the filesystem topology.

## Remote browser access

Recommended topology:

```text
Remote browser → HTTPS reverse proxy → ConvoSketchpad → local OpenClaw Gateway
```

Required configuration:

```bash
HOST=0.0.0.0
CONVOSKETCHPAD_AUTH=true
CONVOSKETCHPAD_SESSION_SECRET=<stable-random-secret>
GATEWAY_URL=http://127.0.0.1:18789
```

Also configure:

- HTTPS through Caddy, Nginx, Traefik, Tailscale Serve, or equivalent.
- `TRUSTED_PROXIES` for proxies that supply client IP headers.
- The final origin in `ALLOWED_ORIGINS`, `CONVOSKETCHPAD_PUBLIC_ORIGIN`, and OpenClaw `gateway.controlUi.allowedOrigins`.

Create a managed user and restart:

```bash
cd ~/convosketchpad
npm run setup
npm run users -- add <name>
sudo systemctl restart convosketchpad.service
```

Back up `database/canvas.sqlite` and `artifacts/` together.

Validate the loopback and public health endpoints, then verify login, Agent discovery, Canvas creation, text and attachment sends, Fork, and Artifact download.

## Tailscale

Tailscale can provide remote access without opening a public port. Prefer Tailscale Serve so ConvoSketchpad remains bound to loopback and the browser receives HTTPS.

```bash
cd ~/convosketchpad
npm run setup
```

Choose **Tailscale Serve**, enable managed authentication, and follow the generated `tailscale serve` command.

The final HTTPS origin must match across:

- `CONVOSKETCHPAD_PUBLIC_ORIGIN`
- `ALLOWED_ORIGINS`
- OpenClaw `gateway.controlUi.allowedOrigins`

Restart ConvoSketchpad and the Gateway after changing origins.

```bash
tailscale status
tailscale serve status
curl -fsS https://<node-name>.<tailnet>.ts.net/health
```

For direct Tailscale-IP access, bind to `0.0.0.0`, enable `CONVOSKETCHPAD_AUTH=true`, and limit plain HTTP to a trusted tailnet.

## Security baseline

- Keep `HOST=127.0.0.1` when remote browser access is not required.
- Enable managed authentication before binding to `0.0.0.0`.
- Use HTTPS for access beyond a trusted local host.
- Keep the OpenClaw Gateway on loopback or a private network path.
- Align public origins across ConvoSketchpad and OpenClaw.
- Configure trusted proxies narrowly.

See [Security](SECURITY.md) for the full model and [Troubleshooting](TROUBLESHOOTING.md) for connection and Session recovery issues.
