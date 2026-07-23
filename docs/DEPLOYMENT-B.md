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
WS_ALLOWED_HOSTS=gateway.example.internal
```

On the Gateway host, add the browser-facing ConvoSketchpad origin to `gateway.controlUi.allowedOrigins`. For a local browser these are normally:

```text
http://localhost:3080
http://127.0.0.1:3080
```

If the browser reaches ConvoSketchpad through a custom origin, also set `NERVE_PUBLIC_ORIGIN` to that exact origin.

## Canvas limitations

Canvas execution, Branch/Fork behavior, events, and transcript reconciliation work through the Gateway. Upload staging and local-path Artifact access require the selected Agent workspace to be accessible on the ConvoSketchpad host. Multipart uploads can still be staged locally, but remote Agent tools cannot use a local-only filesystem path unless the hosts share that path.

For the most predictable attachment and Artifact behavior, run ConvoSketchpad on the same host as OpenClaw.

## Validate

```bash
curl -sS http://127.0.0.1:3080/health
curl -sS https://gateway.example.internal/health
```

Then create a Canvas, confirm the Agent list loads, send a text-only Interaction, and test an attachment appropriate to your shared-filesystem topology.
