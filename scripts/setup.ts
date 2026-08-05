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
import { input, confirm, select } from '@inquirer/prompts';
import { printBanner, section, success, warn, fail, info, dim, promptTheme } from './lib/banner.js';
import { checkPrerequisites, type PrereqResult } from './lib/prereq-check.js';
import {
  isValidPort,
  isValidBindHost,
  isValidIpAddress,
} from './lib/validators.js';
import {
  writeEnvFile,
  backupExistingEnv,
  restoreEnvAfterFailedSetup,
  loadExistingEnv,
  cleanupTmp,
  DEFAULTS,
  type EnvConfig,
} from './lib/env-writer.js';
import {
  agentRuntimeSetupDriver,
  detectAgentRuntimes,
  selectedAgentRuntimeSetupDrivers,
  type RuntimeSetupDetection,
} from './lib/agent-runtimes/setup-registry.js';
import {
  AGENT_RUNTIME_MANIFEST,
  type SupportedAgentRuntimeId,
} from '../server/lib/agent-runtimes/manifest.js';
import { configuredAgentRuntimeIds } from '../server/lib/agent-runtimes/configuration.js';
import { MINIMUM_NODE_VERSION } from '../server/lib/node-version.js';
import {
  applyAccessPlanToConfig,
  buildAccessPlan,
  isLoopbackBrowserOrigin,
  isLoopbackHost,
  parseBrowserOrigins,
  type AccessPlan,
  type InstallerAccessProfile,
} from './lib/access-plan.js';
import { getTailscaleState, type TailscaleState } from './lib/tailscale.js';
import { printDeploymentGuides, shouldPrintDeploymentGuides } from './lib/deployment-guides.js';
import { parseSetupCliOptions, type SetupAccessMode } from './lib/setup-cli-options.js';
import { printSetupHelp } from './lib/setup-help.js';
import {
  chooseAgentRuntimes,
  configureDefaultAgent,
  existingRuntimeIds,
} from './lib/setup-runtime-selection.js';
import { migrateDatabaseAfterSetup as runSetupDatabaseMigration } from './lib/setup-database-migration.js';
import { acquireLock, releaseLock } from '../server/lib/updater/lock.js';

const PROJECT_ROOT = resolve(process.cwd());
const ENV_PATH = resolve(PROJECT_ROOT, '.env');
const TOTAL_SECTIONS = 5;
let activeSetupLockPath: string | null = null;

const supportedRuntimeIds = AGENT_RUNTIME_MANIFEST.map((runtime) => runtime.id);
let cliOptions: ReturnType<typeof parseSetupCliOptions>;
try {
  cliOptions = parseSetupCliOptions(process.argv.slice(2), supportedRuntimeIds);
} catch (error) {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write('Run `npm run setup -- --help` for usage.\n');
  process.exit(1);
}

const isHelp = cliOptions.help;
const isCheck = cliOptions.check;
const isDefaults = cliOptions.defaults;
const requestedAccessMode = cliOptions.accessMode;
const requestedRuntimeIds = cliOptions.runtimeIds as SupportedAgentRuntimeId[] | null;
const requestedDefaultAgentRef = cliOptions.defaultAgent;
type AccessMode = SetupAccessMode;

function detectPrimaryIpv4(): string | null {
  const nets = networkInterfaces();
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs ?? []) {
      if (!addr.internal && addr.family === 'IPv4') return addr.address;
    }
  }
  return null;
}

function hostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveTimer => setTimeout(resolveTimer, ms));
}

async function migrateDatabaseAfterSetup(): Promise<void> {
  await runSetupDatabaseMigration(PROJECT_ROOT, { info, success, warn });
}

async function persistConfiguration(config: EnvConfig): Promise<void> {
  const hadExistingEnvironment = existsSync(ENV_PATH);
  let backupPath: string | undefined;
  if (hadExistingEnvironment) {
    backupPath = backupExistingEnv(ENV_PATH);
    info(`Previous config backed up to ${backupPath.replace(PROJECT_ROOT + '/', '')}`);
  }
  writeEnvFile(ENV_PATH, config);

  try {
    await migrateDatabaseAfterSetup();
  } catch (error) {
    restoreEnvAfterFailedSetup(ENV_PATH, backupPath);
    warn(`Configuration restored to its pre-setup ${hadExistingEnvironment ? 'contents' : 'absence'}.`);
    throw error;
  }
  success('Configuration written to .env');
}

// ── Ctrl+C handler ───────────────────────────────────────────────────

process.on('SIGINT', () => {
  cleanupTmp(ENV_PATH);
  if (activeSetupLockPath) {
    releaseLock(activeSetupLockPath);
    activeSetupLockPath = null;
  }
  console.log('\n\n  Setup cancelled.\n');
  process.exit(130);
});

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (isHelp) {
    printSetupHelp();
    return;
  }

  printBanner(); // no-ops when CONVOSKETCHPAD_INSTALLER is set

  // Clean up stale .env.tmp from previous interrupted runs
  cleanupTmp(ENV_PATH);

  // Prerequisite checks (skip verbose output when called from installer — already checked)
  const prereqs = checkPrerequisites({ quiet: !!process.env.CONVOSKETCHPAD_INSTALLER });
  if (!prereqs.nodeOk) {
    console.log('');
    fail(`Node.js ≥ ${MINIMUM_NODE_VERSION} is required. Please upgrade and try again.`);
    process.exit(1);
  }

  // Hold the shared maintenance lock for the complete mutating setup session,
  // so an updater cannot replace the running setup code or race its config.
  const setupLockPath = isCheck ? null : acquireLock(PROJECT_ROOT);
  activeSetupLockPath = setupLockPath;
  try {

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
    const detections = detectAgentRuntimes(existing);
    const selectedRuntimeIds = await chooseAgentRuntimes({ detections, existing, interactive: false, requestedRuntimeIds });
    await runDefaults(existing, prereqs, detections, selectedRuntimeIds);
    return;
  }

  // If .env exists, ask whether to update or start fresh
  // (Skip this when called from install.sh — the installer already asked)
  if (hasExisting && Object.keys(existing).length > 0 && !process.env.CONVOSKETCHPAD_INSTALLER) {
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

  const detections = detectAgentRuntimes(existing);
  const selectedRuntimeIds = await chooseAgentRuntimes({ detections, existing, interactive: true, requestedRuntimeIds });

  // Run interactive setup
  const config = await collectInteractive(existing, prereqs, detections, selectedRuntimeIds);
  await configureDefaultAgent({ config, selectedRuntimeIds, interactive: true, requestedDefaultAgent: requestedDefaultAgentRef });

  console.log('');
  await persistConfiguration(config);

  printSummary(config);

  // When invoked from install.sh, build is already done — skip misleading "next steps"
  if (!process.env.CONVOSKETCHPAD_INSTALLER) {
    printNextSteps(config);
    printDeploymentGuides();
  }
  } finally {
    if (setupLockPath) releaseLock(setupLockPath);
    activeSetupLockPath = null;
  }
}

// ── Interactive setup ────────────────────────────────────────────────

async function collectInteractive(
  existing: EnvConfig,
  prereqs: PrereqResult,
  detections: RuntimeSetupDetection[],
  selectedRuntimeIds: SupportedAgentRuntimeId[],
): Promise<EnvConfig> {
  const config: EnvConfig = { ...existing };
  config.AGENT_RUNTIMES = selectedRuntimeIds.join(',');
  const runtimeFollowUpSteps: string[] = [];

  // ── 2/5: Agent Runtime configuration ─────────────────────────────

  section(2, TOTAL_SECTIONS, 'Agent Runtime connection');
  dim('Configure each selected Runtime. Local and remote connections are both supported.');
  console.log('');
  for (const driver of selectedAgentRuntimeSetupDrivers(selectedRuntimeIds)) {
    const detection = detections.find((runtime) => runtime.runtimeId === driver.id);
    if (!detection) throw new Error(`Missing setup detection for Runtime ${driver.id}`);
    info(`Configuring ${driver.displayName}`);
    const result = await driver.configureInteractive({
      config,
      existing,
      detection,
    });
    for (const step of result.followUpSteps) {
      if (!runtimeFollowUpSteps.includes(step)) runtimeFollowUpSteps.push(step);
    }
  }

  // ── 3/5: Access Mode ──────────────────────────────────────────────

  section(3, TOTAL_SECTIONS, 'How will you access ConvoSketchpad?');

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
    { name: 'Custom setup (I know what I\'m doing)', value: 'custom', description: 'Manual ConvoSketchpad listener, browser Origins, and proxy trust' },
  ];

  const accessMode = await select<AccessMode>({
    theme: promptTheme,
    message: 'How will you connect to ConvoSketchpad?',
    choices: accessChoices,
  });

  let port = existing.PORT || DEFAULTS.PORT;
  config.PORT = port;
  let accessPlan: AccessPlan;
  let tailscaleState: TailscaleState = prereqs.tailscale;

  function printFollowUpSteps(steps: string[]): void {
    if (steps.length === 0) return;
    for (const step of steps) {
      dim(`  • ${step}`);
    }
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
        if (!isValidIpAddress(val.trim()) || val.trim().includes(':')) return 'Enter a valid IPv4 address';
        return true;
      },
    });
    const ip = lanIp.trim();
    accessPlan = buildAccessPlan({ profile: 'network', port, remoteHost: ip });
    success(`ConvoSketchpad will be available at http://${ip}:${port}`);
    dim(`Make sure your firewall allows traffic on port ${port}`);
    warn('Direct LAN access uses HTTP. Prefer Tailscale Serve or an HTTPS reverse proxy for sensitive traffic.');

  } else {
    port = await input({
      theme: promptTheme,
      message: 'ConvoSketchpad listen port (PORT)',
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
      message: 'ConvoSketchpad listen address (HOST; 127.0.0.1 = local/proxy only, 0.0.0.0 = direct network access)',
      default: existing.HOST || DEFAULTS.HOST,
      validate: value => isValidBindHost(value)
        ? true
        : 'Enter a valid IP address, localhost, or DNS hostname',
    });
    const topology = await select<'direct' | 'proxy'>({
      theme: promptTheme,
      message: 'How will browsers reach ConvoSketchpad?',
      choices: [
        {
          name: 'Direct HTTP connection',
          value: 'direct',
          description: 'Browser connects directly to this ConvoSketchpad listener',
        },
        {
          name: 'HTTPS reverse proxy',
          value: 'proxy',
          description: 'A trusted proxy terminates HTTPS and forwards to this listener',
        },
      ],
    });
    const inferredBrowserHost = customHost === '0.0.0.0' || customHost === '::'
      ? detectPrimaryIpv4() || '127.0.0.1'
      : customHost;
    const defaultOrigin = topology === 'proxy'
      ? existing.ALLOWED_ORIGINS?.split(',')[0]?.trim() || ''
      : `http://${hostForUrl(inferredBrowserHost)}:${port}`;
    const browserOrigins = await input({
      theme: promptTheme,
      message: 'Browser origins (comma-separated, exact scheme + host + port)',
      default: existing.ALLOWED_ORIGINS || defaultOrigin,
      validate: value => {
        const parsed = parseBrowserOrigins(value);
        if (!parsed) return 'Enter one or more exact HTTP(S) origins without paths, queries, or wildcards';
        if (topology === 'direct' && parsed.some(origin => origin.startsWith('https://'))) {
          return 'Direct mode is HTTP-only; choose HTTPS reverse proxy for https:// Origins';
        }
        return true;
      },
    });
    const normalizedOrigins = parseBrowserOrigins(browserOrigins)!;

    let trustedProxies: string[] = [];
    if (topology === 'proxy') {
      const proxyInput = await input({
        theme: promptTheme,
        message: 'Additional trusted proxy IPs (comma-separated; loopback is already trusted)',
        default: existing.TRUSTED_PROXIES || '',
        validate: value => {
          const items = value.split(',').map(item => item.trim()).filter(Boolean);
          return items.every(isValidIpAddress) ? true : 'Trusted proxies must be exact IPv4 or IPv6 addresses';
        },
      });
      trustedProxies = proxyInput.split(',').map(item => item.trim()).filter(Boolean);
    }

    accessPlan = buildAccessPlan({
      profile: 'custom',
      port,
      remoteHost: customHost.trim(),
      browserOrigins: normalizedOrigins,
      trustedProxies,
    });
    success(`Primary browser origin: ${accessPlan.browserOrigins[0]}`);
  }

  delete config.ALLOWED_ORIGINS;
  delete config.TRUSTED_PROXIES;
  Object.assign(config, applyAccessPlanToConfig(config, accessPlan));

  // ── 4/5: Authentication ───────────────────────────────────────────

  // Always generate a session secret if not already set
  if (!config.CONVOSKETCHPAD_SESSION_SECRET) {
    config.CONVOSKETCHPAD_SESSION_SECRET = randomBytes(32).toString('hex');
  }

  const isNetworkExposed = accessPlan.remoteAccess;

  if (isNetworkExposed) {
    section(4, TOTAL_SECTIONS, 'Authentication');
    warn('Your access mode exposes ConvoSketchpad to the network.');
    dim('ConvoSketchpad uses trusted-user tokens: a simple token identifies and isolates each user.');
    dim('This mode is intended for a small controlled environment, not hostile multi-tenant access.');
    console.log('');

    let enableTokenAuth = true;
    if (accessMode === 'custom') {
      enableTokenAuth = await confirm({
        theme: promptTheme,
        message: 'Enable trusted-user token authentication? (recommended)',
        default: true,
      });
    }

    if (!enableTokenAuth) {
      warn('Disabling authentication exposes every Canvas and Gateway capability to anyone who can reach this Origin.');
      const confirmInsecure = await confirm({
        theme: promptTheme,
        message: 'I understand the risk; allow unauthenticated remote access?',
        default: false,
      });
      if (!confirmInsecure) enableTokenAuth = true;
    }

    if (enableTokenAuth) {
      config.CONVOSKETCHPAD_AUTH = 'true';
      delete config.CONVOSKETCHPAD_ALLOW_INSECURE;
      success('Managed-user token authentication enabled.');
      dim('After setup, create the first user with: npm run users -- add <name> [--token <token>]');
    } else {
      config.CONVOSKETCHPAD_AUTH = 'false';
      config.CONVOSKETCHPAD_ALLOW_INSECURE = 'true';
      warn('Authentication disabled with an explicit insecure override.');
    }
  } else {
    delete config.CONVOSKETCHPAD_ALLOW_INSECURE;
    // Localhost — skip auth setup, but preserve existing auth config
    if (existing.CONVOSKETCHPAD_AUTH) config.CONVOSKETCHPAD_AUTH = existing.CONVOSKETCHPAD_AUTH;
    if (existing.CONVOSKETCHPAD_SESSION_SECRET) config.CONVOSKETCHPAD_SESSION_SECRET = existing.CONVOSKETCHPAD_SESSION_SECRET;
    if (existing.CONVOSKETCHPAD_SESSION_TTL) config.CONVOSKETCHPAD_SESSION_TTL = existing.CONVOSKETCHPAD_SESSION_TTL;
  }

  for (const step of runtimeFollowUpSteps) warn(step);

  return config;
}

// ── Summary and next steps ───────────────────────────────────────────

function printSummary(config: EnvConfig): void {
  const port = config.PORT || DEFAULTS.PORT;
  const host = config.HOST || DEFAULTS.HOST;
  const primaryOrigin = config.ALLOWED_ORIGINS?.split(',')[0]?.trim()
    || `http://localhost:${port}`;

  const hostLabel = host === '127.0.0.1' ? '127.0.0.1 (local only)' : `${host} (network)`;
  const authLabel = config.CONVOSKETCHPAD_AUTH === 'true' ? '🔒 Enabled' : 'Disabled';
  const runtimes = config.AGENT_RUNTIMES ?? 'openclaw';
  const runtimeIds = existingRuntimeIds(config);
  const runtimeDetails = runtimeIds.flatMap((runtimeId) =>
    agentRuntimeSetupDriver(runtimeId).summary(config));
  const defaultAgent = config.CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME
    && config.CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE
    ? `${config.CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME}/${config.CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE}`
    : 'First available';

  if (process.env.CONVOSKETCHPAD_INSTALLER) {
    // Rail-style summary — stays inside the installer's visual flow
    const r = `  \x1b[2m│\x1b[0m`;
    console.log('');
    console.log(`${r}  \x1b[2mRuntimes${' '.repeat(3)}\x1b[0m${runtimes}`);
    console.log(`${r}  \x1b[2mDefault${' '.repeat(4)}\x1b[0m${defaultAgent}`);
    for (const detail of runtimeDetails) {
      console.log(`${r}  \x1b[2m${detail.label.padEnd(11)}\x1b[0m${detail.value}`);
    }
    console.log(`${r}  \x1b[2mHTTP${' '.repeat(7)}\x1b[0m:${port}`);
    console.log(`${r}  \x1b[2mOrigin${' '.repeat(5)}\x1b[0m${primaryOrigin}`);
    console.log(`${r}  \x1b[2mHost${' '.repeat(7)}\x1b[0m${hostLabel}`);
    console.log(`${r}  \x1b[2mAuth${' '.repeat(7)}\x1b[0m${authLabel}`);
  } else {
    // Standalone mode — boxed summary
    console.log('');
    console.log('  \x1b[2m┌─────────────────────────────────────────┐\x1b[0m');
    console.log(`  \x1b[2m│\x1b[0m  Runtimes   ${runtimes.padEnd(28)}\x1b[2m│\x1b[0m`);
    console.log(`  \x1b[2m│\x1b[0m  Default    ${defaultAgent.padEnd(28)}\x1b[2m│\x1b[0m`);
    for (const detail of runtimeDetails) {
      console.log(`  \x1b[2m│\x1b[0m  ${detail.label.padEnd(11)}${detail.value.padEnd(28)}\x1b[2m│\x1b[0m`);
    }
    console.log(`  \x1b[2m│\x1b[0m  HTTP       :${port.padEnd(27)}\x1b[2m│\x1b[0m`);
    console.log(`  \x1b[2m│\x1b[0m  Origin     ${primaryOrigin.padEnd(28)}\x1b[2m│\x1b[0m`);
    console.log(`  \x1b[2m│\x1b[0m  Host       ${hostLabel.padEnd(28)}\x1b[2m│\x1b[0m`);
    console.log(`  \x1b[2m│\x1b[0m  Auth       ${authLabel.padEnd(28)}\x1b[2m│\x1b[0m`);
    console.log('  \x1b[2m└─────────────────────────────────────────┘\x1b[0m');
  }
}

function printNextSteps(config: EnvConfig): void {
  const port = config.PORT || DEFAULTS.PORT;
  const primaryOrigin = config.ALLOWED_ORIGINS?.split(',')[0]?.trim()
    || `http://localhost:${port}`;
  console.log('');
  console.log('  \x1b[1mNext steps:\x1b[0m');
  console.log(`    Development:   \x1b[36mnpm run dev\x1b[0m`);
  console.log(`    Production:    \x1b[36mnpm run prod\x1b[0m`);
  console.log('');
  console.log(`  Open \x1b[36m${primaryOrigin}\x1b[0m in your browser.`);
  console.log('');
}

// ── --check mode ─────────────────────────────────────────────────────

async function runCheck(config: EnvConfig): Promise<void> {
  console.log('');
  console.log('  \x1b[1mValidating configuration...\x1b[0m');
  console.log('');

  let errors = 0;

  const supportedRuntimeIds = new Set(AGENT_RUNTIME_MANIFEST.map((runtime) => runtime.id));
  let runtimeIds: SupportedAgentRuntimeId[] = [];
  try {
    runtimeIds = configuredAgentRuntimeIds(config.AGENT_RUNTIMES);
    success(`Agent Runtimes: ${runtimeIds.join(', ')}`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    errors++;
  }

  const defaultRuntime = config.CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME;
  const defaultProfile = config.CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE;
  if (!!defaultRuntime !== !!defaultProfile) {
    fail('Default Agent Runtime and profile must be configured together');
    errors++;
  } else if (defaultRuntime && defaultProfile) {
    if (!runtimeIds.some((runtimeId) => runtimeId === defaultRuntime.toLowerCase())) {
      fail(`Default Agent Runtime is not enabled: ${defaultRuntime}`);
      errors++;
    } else {
      success(`Default Agent: ${defaultRuntime}/${defaultProfile}`);
    }
  } else {
    info('No explicit default Agent; the first available Agent will be used');
  }

  for (const runtimeId of runtimeIds) {
    if (!supportedRuntimeIds.has(runtimeId as SupportedAgentRuntimeId)) continue;
    const driver = agentRuntimeSetupDriver(runtimeId as SupportedAgentRuntimeId);
    info(`Checking ${driver.displayName}`);
    const result = await driver.check(config);
    for (const message of result.successes) success(message);
    for (const message of result.warnings) warn(message);
    for (const message of result.errors) fail(message);
    errors += result.errors.length;
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
  const origins = config.ALLOWED_ORIGINS
    ? parseBrowserOrigins(config.ALLOWED_ORIGINS)
    : [];
  if (config.ALLOWED_ORIGINS && !origins) {
    fail('ALLOWED_ORIGINS contains an invalid or non-Origin URL');
    errors++;
  }
  const remoteAccess = !isLoopbackHost(host)
    || (origins || []).some(origin => !isLoopbackBrowserOrigin(origin));
  if (remoteAccess) {
    warn(`Remote browser access is configured${config.ALLOWED_ORIGINS ? ` for ${config.ALLOWED_ORIGINS}` : ''}`);
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
  } else if (remoteAccess && config.CONVOSKETCHPAD_ALLOW_INSECURE !== 'true') {
    warn('Authentication is DISABLED while server is network-exposed');
    dim('Run `npm run setup` to enable authentication');
    errors++;
  } else if (remoteAccess) {
    warn('Authentication is disabled with CONVOSKETCHPAD_ALLOW_INSECURE=true');
  } else {
    info('Authentication disabled (localhost-only — OK)');
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

async function runDefaults(
  existing: EnvConfig,
  prereqs: PrereqResult,
  detections: RuntimeSetupDetection[],
  selectedRuntimeIds: SupportedAgentRuntimeId[],
): Promise<void> {
  console.log('');
  info('Non-interactive mode — using defaults where possible');
  console.log('');

  const config: EnvConfig = { ...existing };
  config.AGENT_RUNTIMES = selectedRuntimeIds.join(',');
  const followUpSteps: string[] = [];
  let selectedAccessPlan: AccessPlan | null = null;

  if (requestedAccessMode === 'custom') {
    fail('Custom access mode requires interactive questions for bind address, browser Origins, and proxy trust.');
    dim('Run `npm run setup` interactively, or configure HOST, ALLOWED_ORIGINS, and TRUSTED_PROXIES manually.');
    process.exit(1);
  }

  function appendFollowUp(steps: string[]): void {
    for (const step of steps) {
      if (step && !followUpSteps.includes(step)) followUpSteps.push(step);
    }
  }

  for (const driver of selectedAgentRuntimeSetupDrivers(selectedRuntimeIds)) {
    const detection = detections.find((runtime) => runtime.runtimeId === driver.id);
    if (!detection) throw new Error(`Missing setup detection for Runtime ${driver.id}`);
    info(`Configuring ${driver.displayName}`);
    const result = await driver.configureDefaults({
      config,
      detection,
    });
    appendFollowUp(result.followUpSteps);
  }
  if (!config.PORT) config.PORT = DEFAULTS.PORT;
  if (!config.HOST) config.HOST = DEFAULTS.HOST;

  if (requestedAccessMode) {
    const detectedNetworkHost = requestedAccessMode === 'network' ? detectPrimaryIpv4() : null;
    if (requestedAccessMode === 'network' && !detectedNetworkHost) {
      fail('Could not detect a usable LAN IPv4 address for network access mode.');
      dim('Run interactive setup and enter the browser-facing LAN address manually.');
      process.exit(1);
    }
    let accessPlan = buildAccessPlan({
      profile: requestedAccessMode as InstallerAccessProfile,
      port: config.PORT,
      remoteHost: detectedNetworkHost,
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
    Object.assign(config, applyAccessPlanToConfig(config, accessPlan));
    selectedAccessPlan = accessPlan;

    success(`Using access mode: ${accessPlan.profile}`);
    if (accessPlan.browserOrigins[0]) {
      dim(`Primary origin: ${accessPlan.browserOrigins[0]}`);
    }
  }

  // Auth: every standard network-exposed mode enables managed authentication.
  if (!config.CONVOSKETCHPAD_SESSION_SECRET) {
    config.CONVOSKETCHPAD_SESSION_SECRET = randomBytes(32).toString('hex');
  }
  const configuredOrigins = config.ALLOWED_ORIGINS
    ? parseBrowserOrigins(config.ALLOWED_ORIGINS)
    : [];
  if (!configuredOrigins) {
    fail('Existing ALLOWED_ORIGINS contains an invalid or non-Origin URL.');
    dim('Use exact HTTP(S) origins without paths, credentials, queries, fragments, or wildcards.');
    process.exit(1);
  }
  const remoteAccess = selectedAccessPlan?.remoteAccess
    ?? (
      !isLoopbackHost(config.HOST || DEFAULTS.HOST)
      || configuredOrigins.some(origin => !isLoopbackBrowserOrigin(origin))
    );
  if (remoteAccess && config.CONVOSKETCHPAD_AUTH !== 'true') {
    config.CONVOSKETCHPAD_AUTH = 'true';
    delete config.CONVOSKETCHPAD_ALLOW_INSECURE;
    success('Trusted-user token authentication auto-enabled');
    dim('Create the first user with: npm run users -- add <name> [--token <token>]');
  }
  if (!remoteAccess || config.CONVOSKETCHPAD_AUTH === 'true') {
    delete config.CONVOSKETCHPAD_ALLOW_INSECURE;
  }

  await configureDefaultAgent({ config, selectedRuntimeIds, interactive: false, requestedDefaultAgent: requestedDefaultAgentRef });

  await persistConfiguration(config);

  printSummary(config);
  if (shouldPrintDeploymentGuides({ invokedFromInstaller: process.env.CONVOSKETCHPAD_INSTALLER === '1', defaultsMode: true })) {
    printDeploymentGuides();
  }

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
