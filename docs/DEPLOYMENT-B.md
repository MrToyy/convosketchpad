# Deployment: local UI with a remote Gateway

```text
Browser (localhost) → ConvoSketchpad local → OpenClaw Gateway remote
```

Use a private network path such as Tailscale, WireGuard, or an SSH tunnel. Avoid publishing the Gateway port directly.

## Configure

Run `npm run setup` and enter the remote Gateway URL and Token. Keep ConvoSketchpad's access mode local unless the browser must also connect remotely.

Add the Gateway hostname/IP to local `.env`:

```bash
GATEWAY_URL=https://gateway.example.internal
GATEWAY_TOKEN=<token>
CONVOSKETCHPAD_GATEWAY_TIMEZONE=Asia/Shanghai
WS_ALLOWED_HOSTS=gateway.example.internal
```

Set `CONVOSKETCHPAD_GATEWAY_TIMEZONE` to the timezone of the Gateway host, not
necessarily the ConvoSketchpad host. Canvas uses it with OpenClaw's effective
daily/idle reset policy to recover context on the first send after a reset.

On the Gateway host, add the browser-facing ConvoSketchpad origin to `gateway.controlUi.allowedOrigins`. For a local browser these are normally:

```text
http://localhost:3080
http://127.0.0.1:3080
```

Inspect the current array, merge those origins, then use OpenClaw's validated
writer on the Gateway host:

```bash
openclaw config get gateway.controlUi.allowedOrigins --json
openclaw config patch --file ./convosketchpad-origin.patch.json5 --dry-run
openclaw config patch --file ./convosketchpad-origin.patch.json5
```

The patch file is config-shaped and must contain the merged array, for example:

```json5
{
  gateway: {
    controlUi: {
      allowedOrigins: [
        "http://localhost:3080",
        "http://127.0.0.1:3080",
        // Preserve any existing entries reported by `config get`.
      ],
    },
  },
}
```

Local setup never writes the remote Gateway's local config. Pair the device on
that host with:

```bash
openclaw devices list --json
openclaw devices approve <requestId>
```

If the browser reaches ConvoSketchpad through a custom origin, also set `CONVOSKETCHPAD_PUBLIC_ORIGIN` to that exact origin.

## Canvas limitations

Canvas execution, Branch/Fork behavior, events, and transcript reconciliation work through the Gateway. Upload staging and local-path Artifact access require the selected Agent workspace to be accessible on the ConvoSketchpad host. Multipart uploads can still be staged locally, but remote Agent tools cannot use a local-only filesystem path unless the hosts share that path.

For the most predictable attachment and Artifact behavior, run ConvoSketchpad on the same host as OpenClaw.

## Validate

```bash
curl -sS http://127.0.0.1:3080/health
curl -sS https://gateway.example.internal/health
```

Then create a Canvas, confirm the Agent list loads, send a text-only Interaction, and test an attachment appropriate to your shared-filesystem topology.
