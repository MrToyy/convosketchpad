# Install ConvoSketchpad

ConvoSketchpad is **A branching AI workspace for visual thinkers**. It supports macOS and Linux, requires Node.js 22.13 or newer, and connects to an OpenClaw Gateway.

## Recommended install

```bash
curl -fsSL https://raw.githubusercontent.com/MrToyy/convosketchpad/main/install.sh | bash
```

The default installation path is `~/convosketchpad`. Override it with `CONVOSKETCHPAD_INSTALL_DIR` or `--dir <path>`.

The installer runs five stages:

1. **Prerequisites** — checks Node.js, npm, Git, native build tools, OpenClaw, and Gateway availability.
2. **Download** — installs or updates the selected release or branch without discarding a dirty checkout.
3. **Install & Build** — installs npm dependencies and creates the production build.
4. **Configure** — runs the setup wizard unless `--skip-setup` is used.
5. **Service** — configures or restarts the supported service manager, or reports the direct start command.

Run `./install.sh --help` for the authoritative flag list. Common options are:

```text
--dir <path>
--version <vX.Y.Z>
--branch <name>
--repo <url>
--skip-setup
--dry-run
--gateway-token <token>
--gateway-url <url>
--access-mode <local|network|custom|tailscale-ip|tailscale-serve>
```

## Setup wizard

Run the wizard again at any time:

```bash
cd ~/convosketchpad
npm run setup
```

It configures:

1. **Gateway Connection** — URL, Token, connectivity, remote-Gateway timezone, native control-UI origins, and native device pairing.
2. **Access Mode** — localhost, LAN/custom, Tailscale IP, or Tailscale Serve.
3. **Authentication** — managed-user login and session settings for non-local access.

Gateway changes use supported `openclaw config` and `openclaw devices` commands. Setup never synthesizes or edits OpenClaw pairing records directly. Configuration for a remote Gateway must be applied on the Gateway host.

For a non-interactive localhost setup:

```bash
npm run setup -- --defaults
```

For a remote Gateway, also provide its IANA timezone so ConvoSketchpad can predict daily Session resets:

```bash
npm run setup -- --defaults --gateway-timezone Asia/Shanghai
```

## Manual install

```bash
git clone https://github.com/MrToyy/convosketchpad.git ~/convosketchpad
cd ~/convosketchpad
npm install
npm run setup
npm run build
npm start
```

Minimal localhost `.env`:

```bash
PORT=3080
HOST=127.0.0.1
GATEWAY_URL=http://127.0.0.1:18789
GATEWAY_TOKEN=<detected-token>
```

If the installer configured a service, use it instead of starting a duplicate foreground process:

```bash
# Linux
sudo systemctl restart convosketchpad.service

# macOS
launchctl stop com.mrtoyy.convosketchpad || true
launchctl start com.mrtoyy.convosketchpad
```

## Existing installations

Inspect an existing installation before replacing it. Prefer a normal update, setup rerun, service restart, or targeted repair. Never delete, reset, or overwrite an existing dirty checkout without explicit approval.

ConvoSketchpad depends on a reachable OpenClaw Gateway. Reuse an existing Gateway when possible. Installing OpenClaw, changing remote Gateway settings, or increasing network exposure should be an explicit operator decision.

## Deployment choice

Choose the topology that matches where the browser, ConvoSketchpad server, and Gateway will run:

- [Local, same machine](DEPLOYMENT.md#local-same-machine)
- [Local UI with a remote Gateway](DEPLOYMENT.md#local-ui-with-a-remote-gateway)
- [Remote browser access](DEPLOYMENT.md#remote-browser-access)
- [Tailscale](DEPLOYMENT.md#tailscale)

## Managed users

For network-accessible installs, enable `CONVOSKETCHPAD_AUTH=true`, set a stable `CONVOSKETCHPAD_SESSION_SECRET`, and create the first user:

```bash
npm run users -- add <name>
```

The CLI can also list, rotate, disable, or enable users. See [Configuration](CONFIGURATION.md) and [Security](SECURITY.md).

## Validation

Do not treat an installation as complete until the intended process, Gateway connection, access mode, and authentication behavior all work.

```bash
openclaw gateway status
curl -fsS http://127.0.0.1:18789/health
curl -fsS http://127.0.0.1:3080/health
```

Adjust the URLs for the selected topology, then open ConvoSketchpad, confirm Agent discovery, create a Canvas, and send a small Interaction.

For failures, record the exact failing step, checks performed, changes made, and any action still requiring operator access.
