# Security

## Trust model

ConvoSketchpad is a privileged UI for an OpenClaw Gateway. A user who can use the Canvas can ask the selected Agent to use whatever tools and workspace access that Gateway grants. Managed-user isolation separates ConvoSketchpad Canvas rows and durable files; it does not create separate Gateway sandboxes.

## Local default

The safe default is `HOST=127.0.0.1`. Binding to `0.0.0.0` requires `CONVOSKETCHPAD_AUTH=true`, unless `CONVOSKETCHPAD_ALLOW_INSECURE=true` explicitly overrides the startup refusal. Do not use the override on an untrusted network.

## Managed users

- Users are created only through the local CLI.
- The database stores scrypt hashes, never plaintext Tokens.
- Login returns an HttpOnly, SameSite=Strict signed Cookie.
- Rotate, disable, and enable increment `token_version`, invalidating old Cookies.
- HTTP requests and WebSocket activity revalidate current user status.
- Failed logins are rate-limited and temporarily locked by client IP.

Set a stable, random `CONVOSKETCHPAD_SESSION_SECRET` in production. Configure `TRUSTED_PROXIES` only for proxies you control.

## Gateway credentials

The server can inject `GATEWAY_TOKEN` into trusted local/authenticated WebSocket handshakes so the browser does not need to persist it. External unauthenticated clients never receive server-side Token injection. Restrict `WS_ALLOWED_HOSTS`, `ALLOWED_ORIGINS`, and `CSP_CONNECT_EXTRA` to required values.

ConvoSketchpad uses one persistent Ed25519 device identity and asks OpenClaw
for exactly `operator.read` and `operator.write`. Pairing approval and pairing
state remain owned by OpenClaw; ConvoSketchpad does not edit OpenClaw pairing
files. The issued device token is stored server-side in
`~/.convosketchpad/gateway-auth.json` (or `CONVOSKETCHPAD_DATA_DIR`) with mode `0600` and is
redacted from Gateway responses before they reach the browser.

## Canvas ownership

Every Canvas, Branch, Interaction, attachment, Artifact, and send resource is resolved through the authenticated owner. Requests for another owner's resources return 404.

Changing a Canvas Agent is allowed only before the first send. The server validates the Agent against `agents.list`, rewrites draft session keys transactionally, and requires `expectedAgentId` on prepare-send to reject stale-client races.

## File handling

- Uploads are limited to four files and 20 MiB each at the Canvas layer.
- Uploads go directly to owner-scoped Canvas storage and never write an OpenClaw workspace.
- OpenClaw Artifact bytes are requested through `artifacts.download`; there is no generic host-path HTTP route.
- Explicit absolute-path compatibility is limited to a native Agent workspace root or the system temp directory.
- Paths are normalized, resolved with `realpath`, and rejected when a symlink escapes an allowed root.
- Relative workspace reads require the advertised `agents.workspace.get` method.
- Gateway credentials are sent only to same-Gateway Artifact URLs and never to external origins.

## Deployment checklist

1. Use HTTPS for remote access.
2. Enable managed authentication and set `CONVOSKETCHPAD_SESSION_SECRET`.
3. Limit origins, WS target hosts, and trusted proxies.
4. Grant OpenClaw Agents only the tools and filesystem access users should have.
5. Protect `.env`, `.convosketchpad/`, `database/`, `artifacts/`, and the OpenClaw configuration directory.
6. Back up SQLite and Artifacts together.
