# Installer flow

`install.sh` performs five stages:

1. **Prerequisites** — Node.js 22+, npm, Git, native build tools, OpenClaw, and Gateway discovery.
2. **Download** — install or update the selected release/branch without silently discarding an existing dirty checkout.
3. **Install & Build** — run the npm dependency install and production build.
4. **Configure** — run the three-section setup wizard unless `--skip-setup` is used.
5. **Service** — configure/restart the supported service manager or report the direct start command.

The setup wizard contains:

1. **Gateway Connection** — URL, Token, connectivity, remote-Gateway timezone, native control-UI origin config, and native device pairing.
2. **Access Mode** — localhost, Tailscale IP, Tailscale Serve, network, or custom.
3. **Authentication** — managed-user login and session configuration for non-local access.

The installer does not install speech models, ffmpeg for audio, configure TTS/STT providers, create an Agent identity, install bundled Skills, or add Cron/Session-spawn tool permissions.

Gateway changes use only supported OpenClaw commands. Setup capability-checks
`config patch`, `devices list`, and `devices approve`; it never repairs
`paired.json` or `device-auth.json`. Remote Gateway config is left untouched
and setup prints the commands to run on that host.

When `npm run setup` detects a non-loopback Gateway URL, it asks for the
Gateway's IANA timezone so Canvas can predict OpenClaw's daily Session reset.
For non-interactive setup, pass
`npm run setup -- --defaults --gateway-timezone Asia/Shanghai`.

Common flags:

```text
--dir <path>
--version <vX.Y.Z>
--branch <name>
--repo <url>
--skip-setup
--dry-run
--gateway-token <token>
--gateway-url <url>
--access-mode <mode>
```

Use `./install.sh --help` as the authoritative flag reference.
