# Troubleshooting

## Gateway connection fails

Check both services and the configured Token:

```bash
openclaw gateway status
curl -sS http://127.0.0.1:18789/health
curl -sS http://127.0.0.1:3080/health
```

Run `npm run setup` again after a Gateway re-onboard or Token rotation. For a remote Gateway, add its hostname to `WS_ALLOWED_HOSTS`.

## `origin not allowed`

Use the exact browser origin in OpenClaw `gateway.controlUi.allowedOrigins`. For remote access, set the same origin in `NERVE_PUBLIC_ORIGIN` and `ALLOWED_ORIGINS`, then restart both services.

## Agent list cannot load or Canvas creation returns 502

Canvas creation calls Gateway `agents.list`. Confirm the server-side `GATEWAY_TOKEN`, Gateway connectivity, device approval, and required scopes. A Canvas is not created with a guessed Agent when the catalog is unavailable.

## Agent cannot be changed

The selector locks as soon as the first send is prepared. This is intentional: create another Canvas to use a different Agent. If the UI still shows an editable selector after another tab sends, `prepare-send` will reject the stale Agent with `409 agent_changed` and reload the Graph.

## Interaction remains streaming

Terminal Gateway events are only hints. Reconciliation waits for the authoritative transcript. Reloading the Graph reschedules unfinished records; restarting the server also resumes candidates. Check server logs for Gateway transcript or Artifact errors.

## Branch reports Session recovery

OpenClaw replaced or removed the Session behind the stable Branch key. The next send includes ConvoSketchpad's canonical snapshot. This is expected recovery behavior and does not mutate old Interactions.

## Attachment fails

- Maximum four files per send.
- Maximum 20 MiB per file.
- Large images are compressed for model input.
- Workspace paths must stay inside the selected Agent workspace and may not traverse `.git`, `.env`, `node_modules`, or symlinks that escape.
- In split-host deployments, a local staged path may not be visible to the remote Agent.

## Artifact is unavailable

Text completion and Artifact persistence are independent. A late or unreadable Artifact is marked degraded and retried. Verify that `artifacts/` is writable and that the source media remains available during reconciliation.

## Login is locked

The default is three failures in 30 minutes followed by a 30-minute client-IP lockout. Check `NERVE_AUTH_*` values and `TRUSTED_PROXIES`. Restarting clears the in-memory failure tracker but is not a substitute for protecting the Token.

## Remote startup is refused

`HOST=0.0.0.0` requires `NERVE_AUTH=true`. Enable authentication and HTTPS. `NERVE_ALLOW_INSECURE=true` exists only as an explicit unsafe override.

## Build or tests fail

```bash
npm install
npm test -- --run
npx tsc --noEmit -p config/tsconfig.app.json
npx tsc --noEmit -p config/tsconfig.server.json
npm run build
```

Node.js 22.13+ and native build tools are required.
