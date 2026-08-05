export function printSetupHelp(): void {
  console.log(`
  Usage: npm run setup [options]

  Options:
    --check                   Validate existing .env config and test Runtime connections
    --defaults                Non-interactive setup using auto-detected values
    --runtimes <ids>          Comma-separated Agent Runtime IDs to configure
    --default-agent <ref>     Default Agent as <runtime-id>/<profile-id>
    --access-mode <mode>      Non-interactive: local|network|tailscale-ip|tailscale-serve
    --help, -h                Show this help message

  Access modes:
    local             Localhost only
    network           LAN-reachable
    custom            Interactive wizard only: bind, browser Origins, and proxy trust
    tailscale-ip      Direct tailnet IP access
    tailscale-serve   Loopback + Tailscale Serve hostname

  The setup wizard guides you through 5 steps:
    1. Runtime Discovery  — detect and select Agent Runtimes
    2. Runtime Connection — configure each selected Runtime
    3. Access Mode        — local, Tailscale IP, Tailscale Serve, LAN, or custom
    4. Authentication     — trusted-user Token access (network mode)
    5. Default Agent      — choose the Agent selected on new canvases

  Examples:
    npm run setup                                     # Interactive setup
    npm run setup -- --check                          # Validate existing config
    npm run setup -- --defaults                       # Auto-configure with detected values
    npm run setup -- --defaults --access-mode tailscale-serve
    npm run setup -- --defaults --runtimes openclaw --default-agent openclaw/main
`);
}
