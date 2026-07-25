/**
 * Interactive setup wizard for ConvoSketchpad.
 * Guides users through first-time configuration.
 *
 * Usage:
 *   npm run setup               # Interactive setup
 *   npm run setup -- --check    # Validate existing config
 *   npm run setup -- --defaults # Non-interactive with defaults
 */

/** Mask a token for display, with a guard for short tokens. */
// Show token in prompts so users can verify what they entered

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { input, password, confirm, select } from '@inquirer/prompts';
import { printBanner, section, success, warn, fail, info, dim, promptTheme } from './lib/banner.js';
import { checkPrerequisites, type PrereqResult } from './lib/prereq-check.js';
import {
  isValidUrl,
  isValidPort,
  testGatewayConnection,
} from './lib/validators.js';
import {
  writeEnvFile,
  backupExistingEnv,
  loadExistingEnv,
  cleanupTmp,
  DEFAULTS,
  type EnvConfig,
} from './lib/env-writer.js';
import { generateSelfSignedCert } from './lib/cert-gen.js';
import {
  approvePendingConvoSketchpadDevice,
  chooseSetupGatewayToken,
  detectGatewayConfig,
  detectNativeOpenClawCapabilities,
  detectNeededConfigChanges,
  getEnvGatewayToken,
  type ConfigChange,
} from './lib/gateway-detect.js';
import { requestGatewayPairing } from './lib/gateway-pairing.js';
import { applyAccessPlanToConfig, buildAccessPlan, type InstallerAccessProfile } from './lib/access-plan.js';
import { getTailscaleState, type TailscaleState } from './lib/tailscale.js';
import { printDeploymentGuides, shouldPrintDeploymentGuides } from './lib/deployment-guides.js';
import {
  isRemoteGatewayUrl,
  isValidIanaTimezone,
  localIanaTimezone,
} from './lib/gateway-timezone.js';

const PROJECT_ROOT = resolve(process.cwd());
const ENV_PATH = resolve(PROJECT_ROOT, '.env');
const TOTAL_SECTIONS = 3;

const args = process.argv.slice(2);
const isHelp = args.includes('--help') || args.includes('-h');
const isCheck = args.includes('--check');
const isDefaults = args.includes('--defaults');

type AccessMode = 'local' | 'network' | 'custom' | 'tailscale-ip' | 'tailscale-serve';

function getArgValue(flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function normalizeAccessMode(value?: string | null): AccessMode | undefined {
  if (!value) return undefined;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'tailscale') return 'tailscale-ip';

  if (normalized === 'local' || normalized === 'network' || normalized === 'custom' || normalized === 'tailscale-ip' || normalized === 'tailscale-serve') {
    return normalized;
  }

  fail(`Invalid --access-mode value: ${value}`);
  console.log('  Supported values: local, network, custom, tailscale-ip, tailscale-serve');
  process.exit(1);
}

const requestedAccessMode = normalizeAccessMode(getArgValue('--access-mode'));
const requestedGatewayTimezone = getArgValue('--gateway-timezone')?.trim();

function detectPrimaryIpv4(): string | null {
  const nets = networkInterfaces();
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs ?? []) {
      if (!addr.internal && addr.family === 'IPv4') return addr.address;
    }
  }
  return null;
}

/** Check whether a host string is a loopback address (IPv4, IPv6, or localhost). */
function isLoopback(host: string): boolean {
  return !host || host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveTimer => setTimeout(resolveTimer, ms));
}

/**
 * Apply validated OpenClaw-owned config changes.
 */
async function applyConfigChanges(changes: ConfigChange[]): Promise<void> {
  for (const change of changes) {
    const result = change.apply();
    if (result.ok) {
      success(result.message);
    } else {
      warn(result.message);
    }
  }
}

function requireNativeOpenClawCapabilities(
  required: Array<keyof ReturnType<typeof detectNativeOpenClawCapabilities>>,
): void {
  const capabilities = detectNativeOpenClawCapabilities();
  const missing = required.filter(name => !capabilities[name]);
  if (missing.length === 0) return;
  fail(`OpenClaw is missing required native capabilities: ${missing.join(', ')}`);
  dim('Upgrade OpenClaw, then re-run setup. ConvoSketchpad does not patch legacy pairing files.');
  process.exit(1);
}

function pairingOrigin(config: EnvConfig): string {
  return config.CONVOSKETCHPAD_PUBLIC_ORIGIN
    || config.ALLOWED_ORIGINS?.split(',').map(value => value.trim()).find(Boolean)
    || `http://127.0.0.1:${config.PORT || DEFAULTS.PORT}`;
}

function printRemoteOriginInstructions(origins: string[]): void {
  if (origins.length === 0) return;
  warn('The Gateway is remote, so its local OpenClaw configuration was not modified.');
  dim('On the Gateway host, merge these exact origins into gateway.controlUi.allowedOrigins:');
  for (const origin of origins) dim(`  • ${origin}`);
  dim('Use: openclaw config get gateway.controlUi.allowedOrigins --json');
  dim('Put the merged array in a config-shaped JSON5 patch, then run:');
  dim('  openclaw config patch --file ./convosketchpad-origin.patch.json5 --dry-run');
  dim('  openclaw config patch --file ./convosketchpad-origin.patch.json5');
}

async function configureNativePairing(
  config: EnvConfig,
  interactive: boolean,
): Promise<string | null> {
  const probe = await requestGatewayPairing({
    gatewayUrl: config.GATEWAY_URL || DEFAULTS.GATEWAY_URL,
    gatewayToken: config.GATEWAY_TOKEN || '',
    origin: pairingOrigin(config),
  });
  if (probe.status === 'connected') {
    success(probe.message);
    return null;
  }
  if (probe.status !== 'pending') {
    warn(`Could not complete native OpenClaw pairing: ${probe.message}`);
    return 'Start ConvoSketchpad, then approve its request with `openclaw devices list` and `openclaw devices approve <requestId>`.';
  }

  const requestLabel = probe.requestId || '<requestId>';
  if (!interactive) {
    warn(`Native OpenClaw pairing is pending: ${requestLabel}`);
    return `Approve the ConvoSketchpad device on the Gateway host: openclaw devices approve ${requestLabel}`;
  }

  const shouldApprove = await confirm({
    theme: promptTheme,
    message: `Approve ConvoSketchpad device request ${requestLabel} with read/write access?`,
    default: true,
  });
  if (!shouldApprove) {
    return `Approve later with: openclaw devices approve ${requestLabel}`;
  }

  const approved = approvePendingConvoSketchpadDevice({
    gatewayUrl: config.GATEWAY_URL,
    gatewayToken: config.GATEWAY_TOKEN,
  });
  if (!approved.ok || approved.approved !== 1) {
    warn(approved.message);
    return `Approve on the Gateway host with: openclaw devices approve ${requestLabel}`;
  }
  success(approved.message);

  const verified = await requestGatewayPairing({
    gatewayUrl: config.GATEWAY_URL || DEFAULTS.GATEWAY_URL,
    gatewayToken: config.GATEWAY_TOKEN || '',
    origin: pairingOrigin(config),
  });
  if (verified.status === 'connected') {
    success('Native OpenClaw device pairing verified');
    return null;
  }
  return `Pairing was approved but reconnect is still pending: ${verified.message}`;
}

// ── Ctrl+C handler ───────────────────────────────────────────────────

process.on('SIGINT', () => {
  cleanupTmp(ENV_PATH);
  console.log('\n\n  Setup cancelled.\n');
  process.exit(130);
});

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (isHelp) {
    console.log(`
  Usage: npm run setup [options]

  Options:
    --check                   Validate existing .env config and test gateway connection
    --defaults                Non-interactive setup using auto-detected values
    --access-mode <mode>      Explicit non-interactive access mode
    --gateway-timezone <tz>   Gateway IANA timezone (for example Asia/Shanghai)
    --help, -h                Show this help message

  Access modes:
    local             Localhost only
    network           LAN-reachable
    custom            Manual bind and HTTPS choices
    tailscale-ip      Direct tailnet IP access
    tailscale-serve   Loopback + Tailscale Serve hostname

  The setup wizard guides you through 3 steps:
    1. Gateway Connection — connect to your OpenClaw gateway
    2. Access Mode        — local, Tailscale IP, Tailscale Serve, LAN, or custom
    3. Authentication     — trusted-user Token access (network mode)

  Examples:
    npm run setup                                     # Interactive setup
    npm run setup -- --check                          # Validate existing config
    npm run setup -- --defaults                       # Auto-configure with detected values
    npm run setup -- --defaults --access-mode tailscale-serve
    npm run setup -- --defaults --gateway-timezone Asia/Shanghai
`);
    return;
  }

  printBanner(); // no-ops when CONVOSKETCHPAD_INSTALLER is set

  if (requestedGatewayTimezone && !isValidIanaTimezone(requestedGatewayTimezone)) {
    fail(`Invalid --gateway-timezone value: ${requestedGatewayTimezone}`);
    dim('Use an IANA timezone such as Asia/Shanghai or America/New_York.');
    process.exit(1);
  }

  // Clean up stale .env.tmp from previous interrupted runs
  cleanupTmp(ENV_PATH);

  // Prerequisite checks (skip verbose output when called from installer — already checked)
  const prereqs = checkPrerequisites({ quiet: !!process.env.CONVOSKETCHPAD_INSTALLER });
  if (!prereqs.nodeOk) {
    console.log('');
    fail('Node.js ≥ 22 is required. Please upgrade and try again.');
    process.exit(1);
  }

  // Load existing config as defaults
  const hasExisting = existsSync(ENV_PATH);
  const existing: EnvConfig = hasExisting ? loadExistingEnv(ENV_PATH) : {};

  if (hasExisting) {
    info('Found existing .env configuration');
  } else {
    info('No existing .env found — starting fresh setup');
  }

  // --check mode: validate and exit
  if (isCheck) {
    await runCheck(existing);
    return;
  }

  // --defaults mode: non-interactive
  if (isDefaults) {
    await runDefaults(existing, prereqs);
    return;
  }

  // If .env exists, ask whether to update or start fresh
  // (Skip this when called from install.sh — the installer already asked)
  if (hasExisting && existing.GATEWAY_TOKEN && !process.env.CONVOSKETCHPAD_INSTALLER) {
    const action = await select({
    theme: promptTheme,
      message: 'What would you like to do?',
      choices: [
        { name: 'Update existing configuration', value: 'update' },
        { name: 'Start fresh', value: 'fresh' },
        { name: 'Cancel', value: 'cancel' },
      ],
    });
    if (action === 'cancel') {
      console.log('\n  Setup cancelled.\n');
      return;
    }
    if (action === 'fresh') {
      Object.keys(existing).forEach((k) => delete (existing as Record<string, unknown>)[k]);
    }
  }

  // Run interactive setup
  const config = await collectInteractive(existing, prereqs);

  // Write .env
  if (hasExisting) {
    const backupPath = backupExistingEnv(ENV_PATH);
    info(`Previous config backed up to ${backupPath.replace(PROJECT_ROOT + '/', '')}`);
  }
  writeEnvFile(ENV_PATH, config);

  console.log('');
  success('Configuration written to .env');

  printSummary(config);

  // When invoked from install.sh, build is already done — skip misleading "next steps"
  if (!process.env.CONVOSKETCHPAD_INSTALLER) {
    printNextSteps(config);
    printDeploymentGuides();
  }
}

// ── Interactive setup ────────────────────────────────────────────────

async function collectInteractive(
  existing: EnvConfig,
  prereqs: PrereqResult,
): Promise<EnvConfig> {
  const config: EnvConfig = { ...existing };

  // ── 1/3: Gateway Connection ──────────────────────────────────────

  section(1, TOTAL_SECTIONS, 'Gateway Connection');
  dim('ConvoSketchpad connects to your OpenClaw gateway.');
  dim('Make sure the gateway is running before continuing.');
  console.log('');

  // Auto-detect gateway config
  const detected = detectGatewayConfig();
  const envToken = getEnvGatewayToken();
  const tokenChoice = chooseSetupGatewayToken({
    existingToken: existing.GATEWAY_TOKEN,
    detectedToken: detected.token,
    envToken,
  });

  const defaultToken = tokenChoice.token || '';
  const defaultUrl = existing.GATEWAY_URL || detected.url || DEFAULTS.GATEWAY_URL;

  if (tokenChoice.source === 'detected') {
    success('Auto-detected gateway token from local gateway config');
  }
  if (tokenChoice.source === 'env') {
    success('Found OPENCLAW_GATEWAY_TOKEN in environment');
  }

  config.GATEWAY_URL = await input({
    theme: promptTheme,
    message: 'Gateway URL',
    default: defaultUrl,
    validate: (val) => {
      if (!isValidUrl(val)) return 'Please enter a valid HTTP(S) URL';
      return true;
    },
  });

  // If we have an auto-detected token, offer to use it
  if (defaultToken && !existing.GATEWAY_TOKEN) {
    const tokenLabel = tokenChoice.source === 'env' ? 'environment token' : 'detected token';
    const useDetected = await confirm({
    theme: promptTheme,
      message: `Use ${tokenLabel} (${defaultToken})?`,
      default: true,
    });
    if (useDetected) {
      config.GATEWAY_TOKEN = defaultToken;
    } else {
      config.GATEWAY_TOKEN = await password({
    theme: promptTheme,
        message: 'Gateway Auth Token (required)',
        validate: (val) => {
          if (!val || !val.trim()) return 'Gateway token is required';
          return true;
        },
      });
    }
  } else if (existing.GATEWAY_TOKEN) {
    // Existing token — offer to keep it
    const keepExisting = await confirm({
    theme: promptTheme,
      message: `Keep existing gateway token (${existing.GATEWAY_TOKEN})?`,
      default: true,
    });
    if (keepExisting) {
      config.GATEWAY_TOKEN = existing.GATEWAY_TOKEN;
    } else {
      config.GATEWAY_TOKEN = await password({
    theme: promptTheme,
        message: 'Gateway Auth Token (required)',
        validate: (val) => {
          if (!val || !val.trim()) return 'Gateway token is required';
          return true;
        },
      });
    }
  } else {
    dim('Provide the Gateway token explicitly, or inspect it with: openclaw config get gateway.auth.token');
    config.GATEWAY_TOKEN = await password({
    theme: promptTheme,
      message: 'Gateway Auth Token (required)',
      validate: (val) => {
        if (!val || !val.trim()) return 'Gateway token is required';
        return true;
      },
    });
  }

  // Test connection
  const rail = `  \x1b[2m│\x1b[0m`;
  const testPrefix = process.env.CONVOSKETCHPAD_INSTALLER ? `${rail}  ` : '  ';
  process.stdout.write(`${testPrefix}Testing connection... `);
  const gwTest = await testGatewayConnection(config.GATEWAY_URL!, config.GATEWAY_TOKEN);
  if (gwTest.ok) {
    console.log(`\x1b[32m✓\x1b[0m ${gwTest.message}`);
  } else {
    console.log(`\x1b[31m✗\x1b[0m ${gwTest.message}`);
    dim('  Start it with: openclaw gateway start');
    console.log('\n  Setup could not verify your gateway token. Fix the gateway or token, then re-run setup.\n');
    process.exit(1);
  }

  if (requestedGatewayTimezone) {
    config.CONVOSKETCHPAD_GATEWAY_TIMEZONE = requestedGatewayTimezone;
  }
  if (isRemoteGatewayUrl(config.GATEWAY_URL!)) {
    console.log('');
    dim('Canvas uses the Gateway timezone to predict OpenClaw daily session resets.');
    config.CONVOSKETCHPAD_GATEWAY_TIMEZONE = (await input({
      theme: promptTheme,
      message: 'Gateway timezone',
      default:
        requestedGatewayTimezone ||
        existing.CONVOSKETCHPAD_GATEWAY_TIMEZONE ||
        localIanaTimezone(),
      validate: (value) =>
        isValidIanaTimezone(value)
          ? true
          : 'Enter an IANA timezone such as Asia/Shanghai or America/New_York',
    })).trim();
  }

  // ── 2/3: Access Mode ──────────────────────────────────────────────

  section(2, TOTAL_SECTIONS, 'How will you access ConvoSketchpad?');

  const accessChoices: { name: string; value: AccessMode; description: string }[] = [
    { name: 'This machine only (localhost)', value: 'local', description: 'Safest, only accessible from this computer' },
    {
      name: prereqs.tailscale.ipv4 ? `Via Tailscale tailnet IP (${prereqs.tailscale.ipv4})` : 'Via Tailscale tailnet IP',
      value: 'tailscale-ip',
      description: prereqs.tailscale.installed
        ? 'Direct access from other devices on your tailnet'
        : 'Requires Tailscale on this machine',
    },
    {
      name: prereqs.tailscale.dnsName ? `Via Tailscale Serve (${prereqs.tailscale.dnsName})` : 'Via Tailscale Serve',
      value: 'tailscale-serve',
      description: 'Private by default, ConvoSketchpad stays on 127.0.0.1 and is exposed through *.ts.net',
    },
    { name: 'From other devices on my network', value: 'network', description: 'Opens to LAN, you may need to configure your firewall' },
    { name: 'Custom setup (I know what I\'m doing)', value: 'custom', description: 'Manual port, bind address, HTTPS, CORS configuration' },
  ];

  const accessMode = await select<AccessMode>({
    theme: promptTheme,
    message: 'How will you connect to ConvoSketchpad?',
    choices: accessChoices,
  });

  let port = existing.PORT || DEFAULTS.PORT;
  config.PORT = port;
  let sslPort: string | undefined;
  let accessPlan = buildAccessPlan({ profile: 'local', port });
  let tailscaleState: TailscaleState = prereqs.tailscale;

  function printFollowUpSteps(steps: string[]): void {
    if (steps.length === 0) return;
    for (const step of steps) {
      dim(`  • ${step}`);
    }
  }

  async function offerHttpsSetup(remoteHost: string): Promise<string | undefined> {
    console.log('');
    warn('HTTPS protects Canvas content and credentials on non-localhost connections.');
    console.log('');

    const enableHttps = await confirm({
      theme: promptTheme,
      message: 'Enable HTTPS? (recommended)',
      default: true,
    });

    if (!enableHttps) {
      dim('Remote traffic will remain unencrypted unless another HTTPS proxy is used.');
      return undefined;
    }

    let certsReady = false;
    if (prereqs.opensslOk) {
      const certResult = generateSelfSignedCert(PROJECT_ROOT);
      if (certResult.ok) {
        success(certResult.message);
        certsReady = true;
      } else {
        fail(certResult.message);
      }
    } else {
      warn('openssl not found, cannot generate self-signed certificate');
      dim('Install openssl and run: mkdir -p certs && openssl req -x509 -newkey rsa:2048 \\');
      dim('  -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes -subj "/CN=localhost"');
    }

    if (!certsReady) {
      warn('HTTPS disabled because certificates could not be prepared.');
      return undefined;
    }

    const selectedSslPort = await input({
      theme: promptTheme,
      message: 'SSL port',
      default: existing.SSL_PORT || DEFAULTS.SSL_PORT,
      validate: (val) => {
        const n = parseInt(val, 10);
        if (!isValidPort(n)) return 'Please enter a valid port (1–65535)';
        if (n === parseInt(port, 10)) return 'SSL port must differ from HTTP port';
        return true;
      },
    });

    success(`HTTPS will be available at https://${remoteHost}:${selectedSslPort}`);
    dim('Note: Self-signed certs will show a browser warning on first visit, click "Advanced" then "Proceed"');
    return selectedSslPort;
  }

  async function ensureInteractiveTailscale(): Promise<TailscaleState> {
    let state = tailscaleState;

    if (!state.installed) {
      console.log('');
      warn('Tailscale is not installed on this machine.');
      dim('Install it first, then complete browser login with: tailscale up');
      dim('Download: https://tailscale.com/download/linux');
      console.log('\n  Re-run: \x1b[36mnpm run setup\x1b[0m\n');
      process.exit(1);
    }

    if (state.authenticated) {
      return state;
    }

    console.log('');
    warn('Tailscale is installed but not connected.');
    dim('In another terminal, start the browser URL login flow with: tailscale up');
    console.log('');

    const nextAction = await select<'wait' | 'exit'>({
      theme: promptTheme,
      message: 'How should setup continue?',
      choices: [
        { name: 'Wait and continue automatically once Tailscale is connected', value: 'wait' },
        { name: 'Exit and re-run setup later', value: 'exit' },
      ],
    });

    if (nextAction === 'exit') {
      console.log('\n  Finish login with: \x1b[36mtailscale up\x1b[0m');
      console.log('  Then re-run: \x1b[36mnpm run setup\x1b[0m\n');
      process.exit(1);
    }

    process.stdout.write('  Waiting for Tailscale login... ');
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(2000);
      state = getTailscaleState();
      if (state.authenticated) {
        tailscaleState = state;
        console.log(`\x1b[32m✓\x1b[0m ${state.dnsName || state.ipv4 || 'Connected'}`);
        return state;
      }
    }

    console.log('\x1b[31m✗\x1b[0m Timed out waiting for Tailscale login');
    dim('Finish login with: tailscale up');
    console.log('');
    process.exit(1);
  }

  if (accessMode === 'local') {
    accessPlan = buildAccessPlan({ profile: 'local', port });
    success(`ConvoSketchpad will be available at http://localhost:${port}`);

  } else if (accessMode === 'tailscale-ip') {
    tailscaleState = await ensureInteractiveTailscale();
    accessPlan = buildAccessPlan({ profile: 'tailscale-ip', port, tailscale: tailscaleState });
    if (accessPlan.followUpSteps.length > 0) {
      warn('Tailscale tailnet IP access is not ready yet.');
      printFollowUpSteps(accessPlan.followUpSteps);
      console.log('');
      process.exit(1);
    }
    success(`ConvoSketchpad will be available at ${accessPlan.browserOrigins[0]}`);
    dim('Accessible from any device on your Tailscale network');

  } else if (accessMode === 'tailscale-serve') {
    tailscaleState = await ensureInteractiveTailscale();

    console.log('');
    const configureServe = await confirm({
      theme: promptTheme,
      message: `Configure Tailscale Serve now? (tailscale serve --bg http://127.0.0.1:${port})`,
      default: true,
    });

    if (configureServe) {
      try {
        execSync(`tailscale serve --bg http://127.0.0.1:${port}`, { stdio: 'pipe', timeout: 15000, encoding: 'utf8' });
        success(`Tailscale Serve configured for http://127.0.0.1:${port}`);
      } catch (err) {
        const execErr = err as {
          stderr?: string | Buffer;
          message?: string;
          status?: number;
          signal?: string | null;
        };
        const stderr = typeof execErr.stderr === 'string'
          ? execErr.stderr.trim()
          : Buffer.isBuffer(execErr.stderr)
            ? execErr.stderr.toString('utf8').trim()
            : '';
        const status = typeof execErr.status === 'number'
          ? ` (exit ${execErr.status})`
          : execErr.signal
            ? ` (signal ${execErr.signal})`
            : '';
        const detail = stderr || execErr.message || String(err);
        const detailWithStatus = status && !detail.includes(status.trim()) ? `${detail}${status}` : detail;
        warn(`Failed to configure Tailscale Serve automatically: ${detailWithStatus}`);
      }
    } else {
      dim(`Run later: tailscale serve --bg http://127.0.0.1:${port}`);
    }

    tailscaleState = getTailscaleState();
    accessPlan = buildAccessPlan({ profile: 'tailscale-serve', port, tailscale: tailscaleState });

    if (accessPlan.followUpSteps.length > 0) {
      console.log('');
      warn('Could not confirm a usable Tailscale Serve hostname.');
      printFollowUpSteps(accessPlan.followUpSteps);
      console.log('');

      const fallback = await select<'tailscale-ip' | 'stop'>({
        theme: promptTheme,
        message: 'How should setup continue?',
        choices: [
          { name: 'Continue with tailnet IP access instead', value: 'tailscale-ip' },
          { name: 'Stop setup and finish Tailscale Serve manually', value: 'stop' },
        ],
      });

      if (fallback === 'stop') {
        console.log('\n  Finish Tailscale Serve setup, then re-run: \x1b[36mnpm run setup\x1b[0m\n');
        process.exit(1);
      }

      accessPlan = buildAccessPlan({ profile: 'tailscale-ip', port, tailscale: tailscaleState });
      if (accessPlan.followUpSteps.length > 0) {
        warn('Tailnet IP fallback is also unavailable.');
        printFollowUpSteps(accessPlan.followUpSteps);
        console.log('');
        process.exit(1);
      }

      success(`Falling back to tailnet IP access at ${accessPlan.browserOrigins[0]}`);
    } else {
      success(`ConvoSketchpad will be available at ${accessPlan.browserOrigins[0]}`);
      dim('ConvoSketchpad will stay private on 127.0.0.1 and be reached through Tailscale Serve');
    }

  } else if (accessMode === 'network') {
    const detectedIp = detectPrimaryIpv4();
    const lanIp = await input({
      theme: promptTheme,
      message: 'Your LAN IP address',
      default: detectedIp || '',
      validate: (val) => {
        if (!val.trim()) return 'IP address is required for network access';
        if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(val.trim())) return 'Enter a valid IPv4 address';
        return true;
      },
    });
    const ip = lanIp.trim();
    sslPort = await offerHttpsSetup(ip);
    accessPlan = buildAccessPlan({ profile: 'network', port, remoteHost: ip, sslPort });
    success(`ConvoSketchpad will be available at http://${ip}:${port}`);
    dim(`Make sure your firewall allows traffic on port ${port}`);
    dim('Need access from multiple devices? Add more origins to ALLOWED_ORIGINS in .env');

  } else {
    port = await input({
      theme: promptTheme,
      message: 'HTTP port',
      default: existing.PORT || DEFAULTS.PORT,
      validate: (val) => {
        const n = parseInt(val, 10);
        if (!isValidPort(n)) return 'Please enter a valid port (1–65535)';
        return true;
      },
    });
    config.PORT = port;

    const customHost = await input({
      theme: promptTheme,
      message: 'Bind address (127.0.0.1 = local only, 0.0.0.0 = all interfaces)',
      default: existing.HOST || DEFAULTS.HOST,
    });

    if (!isLoopback(customHost)) {
      sslPort = await offerHttpsSetup(customHost);
    } else {
      delete config.SSL_PORT;
    }

    accessPlan = buildAccessPlan({ profile: 'custom', port, remoteHost: customHost, sslPort });
    success(`ConvoSketchpad will be available at http://${customHost}:${port}`);
  }

  delete config.ALLOWED_ORIGINS;
  delete config.CSP_CONNECT_EXTRA;
  delete config.SSL_PORT;
  // WS_ALLOWED_HOSTS is intentionally NOT cleared here. applyAccessPlanToConfig
  // merges plan-derived hosts, the user's existing entries, and the remote-gateway
  // host from GATEWAY_URL, so clearing first would drop user-added allowlist values.
  Object.assign(config, applyAccessPlanToConfig(config, accessPlan));
  if (sslPort) config.SSL_PORT = sslPort;

  // ── Gateway config updates ─────────────────────────────────────────

  const gatewayIsRemote = isRemoteGatewayUrl(config.GATEWAY_URL || DEFAULTS.GATEWAY_URL);
  requireNativeOpenClawCapabilities(
    gatewayIsRemote
      ? ['devicesList', 'devicesApprove']
      : ['configPatch', 'devicesList', 'devicesApprove'],
  );
  const neededChanges = gatewayIsRemote
    ? []
    : detectNeededConfigChanges({ allowedOrigins: accessPlan.gatewayAllowedOrigins });
  if (gatewayIsRemote) {
    printRemoteOriginInstructions(accessPlan.gatewayAllowedOrigins);
  }

  if (neededChanges.length > 0) {
    console.log('');
    warn('ConvoSketchpad needs to update your OpenClaw gateway config.');
    dim('The OpenClaw CLI will validate and apply the change.');
    console.log('');
    dim('The following changes are needed:');
    neededChanges.forEach((change, i) => {
      dim(`  ${i + 1}. ${change.description}`);
    });
    console.log('');

    const applyChanges = await confirm({
      theme: promptTheme,
      message: 'Apply these changes?',
      default: true,
    });

    if (applyChanges) {
      await applyConfigChanges(neededChanges);
    } else {
      warn('Skipped gateway config changes. Some features may not work:');
      for (const change of neededChanges) {
        if (change.id.startsWith('allowed-origins')) {
          dim('  • Origins: use `openclaw config get/patch` to update gateway.controlUi.allowedOrigins');
        }
      }
    }
  }

  const pairingFollowUp = await configureNativePairing(config, true);
  if (pairingFollowUp) warn(pairingFollowUp);

  // ── 3/3: Authentication ───────────────────────────────────────────

  // Always generate a session secret if not already set
  if (!config.CONVOSKETCHPAD_SESSION_SECRET) {
    config.CONVOSKETCHPAD_SESSION_SECRET = randomBytes(32).toString('hex');
  }

  const isNetworkExposed = config.HOST === '0.0.0.0';

  if (isNetworkExposed) {
    section(3, TOTAL_SECTIONS, 'Authentication');
    warn('Your access mode exposes ConvoSketchpad to the network.');
    dim('ConvoSketchpad uses trusted-user tokens: a simple token identifies and isolates each user.');
    dim('This mode is intended for a small controlled environment, not hostile multi-tenant access.');
    console.log('');

    const enableTokenAuth = await confirm({
      theme: promptTheme,
      message: 'Enable trusted-user token authentication? (recommended)',
      default: true,
    });

    if (enableTokenAuth) {
      config.CONVOSKETCHPAD_AUTH = 'true';
      success('Managed-user token authentication enabled.');
      dim('After setup, create the first user with: npm run users -- add <name> [--token <token>]');
    } else {
      config.CONVOSKETCHPAD_AUTH = 'false';
      warn('Authentication disabled. Network-exposed startup will require CONVOSKETCHPAD_ALLOW_INSECURE=true.');
    }
  } else {
    // Localhost — skip auth setup, but preserve existing auth config
    if (existing.CONVOSKETCHPAD_AUTH) config.CONVOSKETCHPAD_AUTH = existing.CONVOSKETCHPAD_AUTH;
    if (existing.CONVOSKETCHPAD_SESSION_SECRET) config.CONVOSKETCHPAD_SESSION_SECRET = existing.CONVOSKETCHPAD_SESSION_SECRET;
    if (existing.CONVOSKETCHPAD_SESSION_TTL) config.CONVOSKETCHPAD_SESSION_TTL = existing.CONVOSKETCHPAD_SESSION_TTL;
  }

  return config;
}

// ── Summary and next steps ───────────────────────────────────────────

function printSummary(config: EnvConfig): void {
  const gwUrl = config.GATEWAY_URL || DEFAULTS.GATEWAY_URL;
  const port = config.PORT || DEFAULTS.PORT;
  const sslPort = config.SSL_PORT || DEFAULTS.SSL_PORT;
  const host = config.HOST || DEFAULTS.HOST;
  const hasCerts = existsSync(resolve(PROJECT_ROOT, 'certs', 'cert.pem'));

  const hostLabel = host === '127.0.0.1' ? '127.0.0.1 (local only)' : `${host} (network)`;
  const authLabel = config.CONVOSKETCHPAD_AUTH === 'true' ? '🔒 Enabled' : 'Disabled';
  const gatewayTimezone = config.CONVOSKETCHPAD_GATEWAY_TIMEZONE;

  if (process.env.CONVOSKETCHPAD_INSTALLER) {
    // Rail-style summary — stays inside the installer's visual flow
    const r = `  \x1b[2m│\x1b[0m`;
    console.log('');
    console.log(`${r}  \x1b[2mGateway${' '.repeat(4)}\x1b[0m${gwUrl}`);
    if (gatewayTimezone) {
      console.log(`${r}  \x1b[2mGateway TZ${' '.repeat(1)}\x1b[0m${gatewayTimezone}`);
    }
    console.log(`${r}  \x1b[2mHTTP${' '.repeat(7)}\x1b[0m:${port}`);
    if (hasCerts) {
      console.log(`${r}  \x1b[2mHTTPS${' '.repeat(6)}\x1b[0m:${sslPort}`);
    }
    console.log(`${r}  \x1b[2mHost${' '.repeat(7)}\x1b[0m${hostLabel}`);
    console.log(`${r}  \x1b[2mAuth${' '.repeat(7)}\x1b[0m${authLabel}`);
  } else {
    // Standalone mode — boxed summary
    console.log('');
    console.log('  \x1b[2m┌─────────────────────────────────────────┐\x1b[0m');
    console.log(`  \x1b[2m│\x1b[0m  Gateway    ${gwUrl.padEnd(28)}\x1b[2m│\x1b[0m`);
    if (gatewayTimezone) {
      console.log(`  \x1b[2m│\x1b[0m  Gateway TZ ${gatewayTimezone.padEnd(28)}\x1b[2m│\x1b[0m`);
    }
    console.log(`  \x1b[2m│\x1b[0m  HTTP       :${port.padEnd(27)}\x1b[2m│\x1b[0m`);
    if (hasCerts) {
      console.log(`  \x1b[2m│\x1b[0m  HTTPS      :${sslPort.padEnd(27)}\x1b[2m│\x1b[0m`);
    }
    console.log(`  \x1b[2m│\x1b[0m  Host       ${hostLabel.padEnd(28)}\x1b[2m│\x1b[0m`);
    console.log(`  \x1b[2m│\x1b[0m  Auth       ${authLabel.padEnd(28)}\x1b[2m│\x1b[0m`);
    console.log('  \x1b[2m└─────────────────────────────────────────┘\x1b[0m');
  }
}

function printNextSteps(config: EnvConfig): void {
  const developmentPort = config.VITE_PORT || '3080';
  console.log('');
  console.log('  \x1b[1mNext steps:\x1b[0m');
  console.log(`    Development:   \x1b[36mnpm run dev\x1b[0m`);
  console.log(`    Production:    \x1b[36mnpm run prod\x1b[0m`);
  console.log('');
  console.log(`  Open \x1b[36mhttp://localhost:${developmentPort}\x1b[0m in your browser.`);
  console.log('');
}

// ── --check mode ─────────────────────────────────────────────────────

async function runCheck(config: EnvConfig): Promise<void> {
  console.log('');
  console.log('  \x1b[1mValidating configuration...\x1b[0m');
  console.log('');

  let errors = 0;

  // Gateway token
  if (config.GATEWAY_TOKEN) {
    success('GATEWAY_TOKEN is set');
  } else {
    fail('GATEWAY_TOKEN is missing (required)');
    errors++;
  }

  // Gateway URL
  const gwUrl = config.GATEWAY_URL || DEFAULTS.GATEWAY_URL;
  if (isValidUrl(gwUrl)) {
    success(`GATEWAY_URL is valid: ${gwUrl}`);

    // Test connectivity and token validity
    process.stdout.write('  Testing gateway connection... ');
    const gwTest = await testGatewayConnection(gwUrl, config.GATEWAY_TOKEN);
    if (gwTest.ok) {
      console.log(`\x1b[32m✓\x1b[0m ${gwTest.message}`);
    } else {
      console.log(`\x1b[31m✗\x1b[0m ${gwTest.message}`);
      errors++;
    }
  } else {
    fail(`GATEWAY_URL is invalid: ${gwUrl}`);
    errors++;
  }

  if (config.CONVOSKETCHPAD_GATEWAY_TIMEZONE) {
    if (isValidIanaTimezone(config.CONVOSKETCHPAD_GATEWAY_TIMEZONE)) {
      success(`Gateway timezone is valid: ${config.CONVOSKETCHPAD_GATEWAY_TIMEZONE}`);
    } else {
      fail(`CONVOSKETCHPAD_GATEWAY_TIMEZONE is invalid: ${config.CONVOSKETCHPAD_GATEWAY_TIMEZONE}`);
      errors++;
    }
  } else if (isRemoteGatewayUrl(gwUrl)) {
    warn(`CONVOSKETCHPAD_GATEWAY_TIMEZONE is not set; using this host's timezone (${localIanaTimezone()})`);
    dim('Set it to the timezone used by the remote OpenClaw Gateway.');
  }

  // Port
  const port = parseInt(config.PORT || DEFAULTS.PORT, 10);
  if (isValidPort(port)) {
    success(`PORT is valid: ${port}`);
  } else {
    fail(`PORT is invalid: ${config.PORT}`);
    errors++;
  }

  // Host binding
  const host = config.HOST || DEFAULTS.HOST;
  if (host === '0.0.0.0') {
    warn('HOST is 0.0.0.0 — server is accessible from the network');
  } else {
    success(`HOST: ${host}`);
  }

  // Auth
  if (config.CONVOSKETCHPAD_AUTH === 'true') {
    success('Trusted-user token authentication is enabled');
    if (config.CONVOSKETCHPAD_SESSION_SECRET) {
      success('Session secret is set');
    } else {
      warn('CONVOSKETCHPAD_SESSION_SECRET not set — will be auto-generated (sessions won\'t survive restarts)');
    }
  } else if (host === '0.0.0.0') {
    warn('Authentication is DISABLED while server is network-exposed');
    dim('Run `npm run setup` to enable authentication');
  } else {
    info('Authentication disabled (localhost-only — OK)');
  }

  // HTTPS certs
  if (existsSync(resolve(PROJECT_ROOT, 'certs', 'cert.pem'))) {
    success('HTTPS certificates found at certs/');
  } else {
    info('No HTTPS certificates (HTTP only)');
  }

  console.log('');
  if (errors > 0) {
    fail(`${errors} issue(s) found. Run \x1b[36mnpm run setup\x1b[0m to fix.`);
    process.exit(1);
  } else {
    success('Configuration looks good!');
  }
  console.log('');
}

// ── --defaults mode ──────────────────────────────────────────────────

async function runDefaults(existing: EnvConfig, prereqs: PrereqResult): Promise<void> {
  console.log('');
  info('Non-interactive mode — using defaults where possible');
  console.log('');

  const config: EnvConfig = { ...existing };
  const followUpSteps: string[] = [];

  function appendFollowUp(steps: string[]): void {
    for (const step of steps) {
      if (step && !followUpSteps.includes(step)) followUpSteps.push(step);
    }
  }

  // Try to auto-detect gateway token
  if (!config.GATEWAY_TOKEN) {
    const detected = detectGatewayConfig();
    const envToken = getEnvGatewayToken();
    const tokenChoice = chooseSetupGatewayToken({
      detectedToken: detected.token,
      envToken,
    });

    if (tokenChoice.token) {
      config.GATEWAY_TOKEN = tokenChoice.token;
      success(`Auto-detected gateway token${tokenChoice.source === 'env' ? ' from environment' : ''}`);
    } else {
      fail('GATEWAY_TOKEN is required but could not be auto-detected');
      console.log('  Set OPENCLAW_GATEWAY_TOKEN in your environment, or run setup interactively.');
      console.log('');
      process.exit(1);
    }
  }

  if (!config.GATEWAY_URL) config.GATEWAY_URL = DEFAULTS.GATEWAY_URL;
  if (requestedGatewayTimezone) {
    config.CONVOSKETCHPAD_GATEWAY_TIMEZONE = requestedGatewayTimezone;
  } else if (
    isRemoteGatewayUrl(config.GATEWAY_URL) &&
    !config.CONVOSKETCHPAD_GATEWAY_TIMEZONE
  ) {
    config.CONVOSKETCHPAD_GATEWAY_TIMEZONE = localIanaTimezone();
    warn(`Remote Gateway detected; using Gateway timezone ${config.CONVOSKETCHPAD_GATEWAY_TIMEZONE}`);
    dim('Override with --gateway-timezone <IANA timezone> when the Gateway uses another timezone.');
  }
  if (
    config.CONVOSKETCHPAD_GATEWAY_TIMEZONE &&
    !isValidIanaTimezone(config.CONVOSKETCHPAD_GATEWAY_TIMEZONE)
  ) {
    fail(`CONVOSKETCHPAD_GATEWAY_TIMEZONE is invalid: ${config.CONVOSKETCHPAD_GATEWAY_TIMEZONE}`);
    process.exit(1);
  }
  if (!config.PORT) config.PORT = DEFAULTS.PORT;
  if (!config.HOST) config.HOST = DEFAULTS.HOST;

  if (requestedAccessMode) {
    let accessPlan = buildAccessPlan({
      profile: requestedAccessMode as InstallerAccessProfile,
      port: config.PORT,
      sslPort: config.SSL_PORT,
      remoteHost: !isLoopback(config.HOST || '') ? config.HOST : detectPrimaryIpv4() || config.HOST || DEFAULTS.HOST,
      tailscale: prereqs.tailscale,
    });

    if (requestedAccessMode === 'tailscale-serve' && accessPlan.followUpSteps.length > 0) {
      warn('Tailscale Serve could not be confirmed in non-interactive mode. Falling back to tailnet IP support only.');
      appendFollowUp(accessPlan.followUpSteps);
      accessPlan = buildAccessPlan({
        profile: 'tailscale-ip',
        port: config.PORT,
        tailscale: prereqs.tailscale,
      });
    }

    if ((requestedAccessMode === 'tailscale-ip' || requestedAccessMode === 'tailscale-serve') && accessPlan.followUpSteps.length > 0) {
      warn('Requested Tailscale access mode is not ready in non-interactive mode. Keeping localhost-only access for now.');
      appendFollowUp(accessPlan.followUpSteps);
      accessPlan = buildAccessPlan({ profile: 'local', port: config.PORT });
    }

    delete config.ALLOWED_ORIGINS;
    delete config.CSP_CONNECT_EXTRA;
    // WS_ALLOWED_HOSTS preserved across setup runs. See merge logic in
    // applyAccessPlanToConfig (plan + existing + remote-gateway host).
    Object.assign(config, applyAccessPlanToConfig(config, accessPlan));

    success(`Using access mode: ${accessPlan.profile}`);
    if (accessPlan.browserOrigins[0]) {
      dim(`Primary origin: ${accessPlan.browserOrigins[0]}`);
    }
  }

  // Auth: auto-enable when network-exposed with gateway token, generate session secret
  if (!config.CONVOSKETCHPAD_SESSION_SECRET) {
    config.CONVOSKETCHPAD_SESSION_SECRET = randomBytes(32).toString('hex');
  }
  if (config.HOST === '0.0.0.0' && !config.CONVOSKETCHPAD_AUTH) {
    if (config.GATEWAY_TOKEN) {
      config.CONVOSKETCHPAD_AUTH = 'true';
      success('Trusted-user token authentication auto-enabled');
      dim('Create the first user with: npm run users -- add <name> [--token <token>]');
    } else {
      warn('Network-exposed without authentication — consider running interactive setup');
    }
  }

  process.stdout.write('  Testing gateway connection... ');
  const gwTest = await testGatewayConnection(config.GATEWAY_URL!, config.GATEWAY_TOKEN);
  if (gwTest.ok) {
    console.log(`\x1b[32m✓\x1b[0m ${gwTest.message}`);
  } else {
    console.log(`\x1b[31m✗\x1b[0m ${gwTest.message}`);
    fail('Refusing to write .env because gateway auth could not be verified.');
    console.log('');
    process.exit(1);
  }

  const requestedOrigins = config.ALLOWED_ORIGINS
    ?.split(',')
    .map(origin => origin.trim())
    .filter(Boolean) || [];
  const gatewayIsRemote = isRemoteGatewayUrl(config.GATEWAY_URL || DEFAULTS.GATEWAY_URL);
  if (!gatewayIsRemote) {
    requireNativeOpenClawCapabilities(['configPatch']);
  }
  const changes = gatewayIsRemote
    ? []
    : detectNeededConfigChanges({ allowedOrigins: requestedOrigins });
  if (gatewayIsRemote) {
    printRemoteOriginInstructions(requestedOrigins);
  }
  if (changes.length > 0) {
    await applyConfigChanges(changes);
  }

  if (existsSync(ENV_PATH)) {
    const backupPath = backupExistingEnv(ENV_PATH);
    info(`Previous config backed up to ${backupPath.replace(PROJECT_ROOT + '/', '')}`);
  }
  writeEnvFile(ENV_PATH, config);

  success('Configuration written to .env');

  printSummary(config);
  if (shouldPrintDeploymentGuides({ invokedFromInstaller: process.env.CONVOSKETCHPAD_INSTALLER === '1', defaultsMode: true })) {
    printDeploymentGuides();
  }

  const pairingFollowUp = await configureNativePairing(config, false);
  if (pairingFollowUp) appendFollowUp([pairingFollowUp]);

  if (followUpSteps.length > 0) {
    console.log('');
    warn('Additional follow-up is required:');
    for (const step of followUpSteps) {
      dim(`  • ${step}`);
    }
  }

  console.log('');
}

// ── Run ──────────────────────────────────────────────────────────────

main().catch((err) => {
  // ExitPromptError is thrown when user presses Ctrl+C during a prompt
  if (err?.name === 'ExitPromptError') {
    cleanupTmp(ENV_PATH);
    console.log('\n\n  Setup cancelled.\n');
    process.exit(130);
  }
  console.error('\n  Setup failed:', err.message || err);
  cleanupTmp(ENV_PATH);
  process.exit(1);
});
