/**
 * Service management — detect and control systemd / launchd services owned by
 * the current installation. Detection order: systemd first, then launchd.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ServiceManager, ServiceState } from './types.js';

const SYSTEMD_UNIT = 'convosketchpad.service';
const LAUNCHD_LABEL = 'com.mrtoyy.convosketchpad';

function canonicalPath(value: string): string {
  const absolute = resolve(value.trim());
  if (!existsSync(absolute)) return absolute;
  try { return realpathSync.native(absolute); } catch { return absolute; }
}

export function serviceConfigurationMatchesInstallation(
  workingDirectory: string,
  command: string,
  cwd: string,
): boolean {
  if (!workingDirectory.trim() || canonicalPath(workingDirectory) !== canonicalPath(cwd)) return false;
  const normalizedCommand = command.replaceAll('\\', '/');
  const installation = canonicalPath(cwd).replaceAll('\\', '/').replace(/\/+$/, '');
  return normalizedCommand.includes(`${installation}/server-dist/index.js`)
    || normalizedCommand.includes(`${installation}/start.sh`)
    || /(?:^|[\s=;])server-dist\/index\.js(?:$|[\s;}])/u.test(normalizedCommand);
}

export function systemdStateFromOutput(output: string): ServiceState {
  const state = output.trim().toLowerCase();
  if (state === 'active') return 'active';
  if (state === 'inactive' || state === 'failed') return 'inactive';
  if (state === 'activating' || state === 'deactivating' || state === 'reloading') return 'transitioning';
  return 'unknown';
}

export function findSystemdUnitFromOutput(output: string): string | null {
  for (const line of output.split('\n')) {
    const unit = line.trim().split(/\s+/)[0];
    if (unit === SYSTEMD_UNIT) return unit;
  }
  return null;
}

export function findLaunchdLabelFromOutput(output: string): string | null {
  for (const line of output.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[parts.length - 1] === LAUNCHD_LABEL) return LAUNCHD_LABEL;
  }
  return null;
}

export interface SystemdInvocationOptions {
  isRoot?: boolean;
  interactive?: boolean;
}

/** Build the least-privileged systemctl invocation for a mutating operation. */
export function systemdControlInvocation(
  isUserUnit: boolean,
  args: string[],
  options: SystemdInvocationOptions = {},
): { command: string; args: string[]; stdio: 'inherit' | 'pipe' } {
  if (isUserUnit) {
    return { command: 'systemctl', args: ['--user', ...args], stdio: 'pipe' };
  }
  const isRoot = options.isRoot ?? (typeof process.getuid === 'function' && process.getuid() === 0);
  if (isRoot) return { command: 'systemctl', args, stdio: 'pipe' };
  const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stderr.isTTY);
  return {
    command: 'sudo',
    args: [...(interactive ? [] : ['-n']), 'systemctl', ...args],
    stdio: interactive ? 'inherit' : 'pipe',
  };
}

// ── Systemd adapter ──────────────────────────────────────────────────

class SystemdManager implements ServiceManager {
  readonly name = 'systemd';
  private unit = '';
  private isUserUnit = false;

  detect(cwd: string): boolean {
    try {
      execFileSync('systemctl', ['--version'], { stdio: 'pipe' });
    } catch {
      return false;
    }

    // Search system units first, then user units
    const systemUnit = this.findUnit(false, cwd);
    if (systemUnit) {
      this.unit = systemUnit;
      this.isUserUnit = false;
      return true;
    }

    const userUnit = this.findUnit(true, cwd);
    if (userUnit) {
      this.unit = userUnit;
      this.isUserUnit = true;
      return true;
    }

    return false;
  }

  async restart(): Promise<void> {
    this.control('restart');
  }

  async stop(): Promise<void> {
    this.control('stop');
  }

  async status(): Promise<ServiceState> {
    const args = [...(this.isUserUnit ? ['--user'] : []), 'is-active', this.unit];
    try {
      return systemdStateFromOutput(execFileSync('systemctl', args, { stdio: 'pipe' }).toString());
    } catch (error) {
      const stdout = error && typeof error === 'object' && 'stdout' in error
        ? (error as { stdout?: Buffer | string }).stdout
        : undefined;
      return stdout ? systemdStateFromOutput(String(stdout)) : 'unknown';
    }
  }

  async getLogs(lines: number): Promise<string> {
    try {
      return execFileSync(
        'journalctl',
        [...(this.isUserUnit ? ['--user'] : []), '-u', this.unit, '-n', String(lines), '--no-pager'],
        { stdio: 'pipe' },
      ).toString();
    } catch {
      return '';
    }
  }

  private findUnit(user: boolean, cwd: string): string | null {
    try {
      const output = execFileSync(
        'systemctl',
        [...(user ? ['--user'] : []), 'list-units', '--type=service', '--all', '--no-legend'],
        { stdio: 'pipe' },
      ).toString();

      const unit = findSystemdUnitFromOutput(output);
      if (!unit) return null;
      const scope = user ? ['--user'] : [];
      const workingDirectory = execFileSync(
        'systemctl',
        [...scope, 'show', unit, '--property=WorkingDirectory', '--value'],
        { stdio: 'pipe' },
      ).toString().trim();
      const command = execFileSync(
        'systemctl',
        [...scope, 'show', unit, '--property=ExecStart', '--value'],
        { stdio: 'pipe' },
      ).toString().trim();
      return serviceConfigurationMatchesInstallation(workingDirectory, command, cwd) ? unit : null;
    } catch {
      // systemd not available for this scope
    }
    return null;
  }

  private control(action: 'restart' | 'stop'): void {
    const invocation = systemdControlInvocation(this.isUserUnit, [action, this.unit]);
    execFileSync(invocation.command, invocation.args, { stdio: invocation.stdio });
  }
}

// ── Launchd adapter ──────────────────────────────────────────────────

export class LaunchdManager implements ServiceManager {
  readonly name = 'launchd';
  private label = '';
  private plist = '';
  private uid = '';
  private unloadedForMaintenance = false;

  detect(cwd: string): boolean {
    if (process.platform !== 'darwin') return false;

    try {
      const plist = join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
      if (!existsSync(plist)) return false;
      const workingDirectory = this.readPlistValue(plist, 'WorkingDirectory');
      const command = this.readPlistValue(plist, 'ProgramArguments:0');
      if (!serviceConfigurationMatchesInstallation(workingDirectory, command, cwd)) return false;
      this.label = LAUNCHD_LABEL;
      this.plist = plist;
      this.uid = execFileSync('id', ['-u'], { stdio: 'pipe' }).toString().trim();
      try {
        execFileSync('launchctl', ['print', `gui/${this.uid}/${this.label}`], { stdio: 'pipe' });
        this.unloadedForMaintenance = false;
      } catch (error) {
        if (!launchdServiceIsMissing(error)) return false;
        // The plist still identifies this installation. Remember that the Job
        // is unloaded so a later updater process can resume and bootstrap it.
        this.unloadedForMaintenance = true;
      }
      return true;
    } catch {
      // no launchd
    }

    return false;
  }

  async restart(): Promise<void> {
    const target = `gui/${this.uid}/${this.label}`;
    if (this.unloadedForMaintenance) {
      execFileSync('launchctl', ['bootstrap', `gui/${this.uid}`, this.plist], { stdio: 'pipe' });
      this.unloadedForMaintenance = false;
    }
    execFileSync('launchctl', ['kickstart', '-k', target], { stdio: 'pipe' });
  }

  async stop(): Promise<void> {
    if (this.unloadedForMaintenance) return;
    execFileSync('launchctl', ['bootout', `gui/${this.uid}/${this.label}`], { stdio: 'pipe' });
    this.unloadedForMaintenance = true;
  }

  async status(): Promise<ServiceState> {
    try {
      const output = execFileSync(
        'launchctl',
        ['print', `gui/${this.uid}/${this.label}`],
        { stdio: 'pipe' },
      ).toString();
      return launchdStateFromPrintOutput(output);
    } catch (error) {
      return this.unloadedForMaintenance && launchdServiceIsMissing(error) ? 'inactive' : 'unknown';
    }
  }

  async getLogs(lines: number): Promise<string> {
    try {
      const output = execFileSync(
        'log',
        ['show', '--predicate', 'processImagePath contains "convosketchpad"', '--last', '5m', '--info'],
        { stdio: 'pipe' },
      ).toString();
      return output.split('\n').slice(-lines).join('\n');
    } catch {
      return '';
    }
  }

  private readPlistValue(plist: string, key: string): string {
    return execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', `Print :${key}`, plist],
      { stdio: 'pipe' },
    ).toString().trim();
  }
}

export function launchdStateFromPrintOutput(output: string): ServiceState {
  if (/^\s*pid\s*=\s*\d+\s*$/mu.test(output) || /^\s*state\s*=\s*running\s*$/mu.test(output)) {
    return 'active';
  }
  return output.trim() ? 'inactive' : 'unknown';
}

export function launchdServiceIsMissing(error: unknown): boolean {
  const values: string[] = [];
  if (error instanceof Error) values.push(error.message);
  if (error && typeof error === 'object') {
    for (const key of ['stdout', 'stderr'] as const) {
      if (key in error) values.push(String((error as Record<string, unknown>)[key] ?? ''));
    }
  }
  return /could not find service|service not loaded|not found in domain/i.test(values.join('\n'));
}

export async function waitForServiceState(
  manager: ServiceManager,
  expected: Exclude<ServiceState, 'unknown'>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<ServiceState> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let state = await manager.status();
  while (state !== expected && Date.now() < deadline) {
    if (state === 'unknown') return state;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
    state = await manager.status();
  }
  return state;
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Detect the active service manager, or null if neither is found.
 * Tries systemd first, then launchd.
 */
export function detectServiceManager(cwd: string): ServiceManager | null {
  const systemd = new SystemdManager();
  if (systemd.detect(cwd)) return systemd;

  const launchd = new LaunchdManager();
  if (launchd.detect(cwd)) return launchd;

  return null;
}
