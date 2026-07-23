# Tailscale access

Tailscale can expose ConvoSketchpad without opening a public port. Prefer Tailscale Serve because ConvoSketchpad remains bound to loopback and the browser receives HTTPS.

## Guided setup

```bash
cd ~/convosketchpad
npm run setup
```

Choose **Tailscale Serve**, enable managed authentication, and follow the generated `tailscale serve` command.

## Required origin alignment

The final HTTPS origin must agree across:

- `NERVE_PUBLIC_ORIGIN`
- `ALLOWED_ORIGINS`
- OpenClaw `gateway.controlUi.allowedOrigins`

Restart both ConvoSketchpad and the Gateway after changing origins.

## Validate

```bash
tailscale status
tailscale serve status
curl -sS https://<node-name>.<tailnet>.ts.net/health
```

Then verify managed login, Gateway connection, Agent discovery, and a Canvas Interaction.

For direct Tailscale-IP access without Serve, bind to `0.0.0.0`, enable `NERVE_AUTH=true`, and understand that plain HTTP is not suitable outside a trusted tailnet.
