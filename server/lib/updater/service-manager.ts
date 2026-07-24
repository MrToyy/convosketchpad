/**
 * Service management — detect and control systemd / launchd services.
 * Detection order: systemd first, then launchd.
 */

import { execSync } from 'node:child_process';
import type { ServiceManager } from './types.js';

const SYSTEMD_UNIT = 'convosketchpad.service';
const LAUNCHD_LABEL = 'com.mrtoyy.convosketchpad';

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

// ── Systemd adapter ──────────────────────────────────────────────────

class SystemdManager implements ServiceManager {
  readonly name = 'systemd';
  private unit = '';
  private isUserUnit = false;

  detect(): boolean {
    try {
      execSync('systemctl --version', { stdio: 'pipe' });
    } catch {
      return false;
    }

    // Search system units first, then user units
    const systemUnit = this.findUnit(false);
    if (systemUnit) {
      this.unit = systemUnit;
      this.isUserUnit = false;
      return true;
    }

    const userUnit = this.findUnit(true);
    if (userUnit) {
      this.unit = userUnit;
      this.isUserUnit = true;
      return true;
    }

    return false;
  }

  async restart(): Promise<void> {
    const flag = this.isUserUnit ? '--user ' : '';
    execSync(`systemctl ${flag}restart ${this.unit}`.trim(), { stdio: 'pipe' });
  }

  async isActive(): Promise<boolean> {
    try {
      const flag = this.isUserUnit ? '--user ' : '';
      const result = execSync(`systemctl ${flag}is-active ${this.unit}`.trim(), {
        stdio: 'pipe',
      })
        .toString()
        .trim();
      return result === 'active';
    } catch {
      return false;
    }
  }

  async getLogs(lines: number): Promise<string> {
    try {
      const flag = this.isUserUnit ? '--user ' : '';
      return execSync(
        `journalctl ${flag}-u ${this.unit} -n ${lines} --no-pager`.trim(),
        { stdio: 'pipe' },
      ).toString();
    } catch {
      return '';
    }
  }

  private findUnit(user: boolean): string | null {
    try {
      const flag = user ? '--user ' : '';
      const output = execSync(
        `systemctl ${flag}list-units --type=service --all --no-legend`.trim(),
        { stdio: 'pipe' },
      ).toString();

      return findSystemdUnitFromOutput(output);
    } catch {
      // systemd not available for this scope
    }
    return null;
  }
}

// ── Launchd adapter ──────────────────────────────────────────────────

class LaunchdManager implements ServiceManager {
  readonly name = 'launchd';
  private label = '';

  detect(): boolean {
    if (process.platform !== 'darwin') return false;

    try {
      const output = execSync('launchctl list', { stdio: 'pipe' }).toString();
      const label = findLaunchdLabelFromOutput(output);
      if (label) {
        this.label = label;
        return true;
      }
    } catch {
      // no launchd
    }

    return false;
  }

  async restart(): Promise<void> {
    const uid = execSync('id -u', { stdio: 'pipe' }).toString().trim();
    try {
      execSync(`launchctl kickstart -k gui/${uid}/${this.label}`, { stdio: 'pipe' });
    } catch {
      // Fallback to stop + start
      try {
        execSync(`launchctl stop ${this.label}`, { stdio: 'pipe' });
      } catch {
        // may already be stopped
      }
      execSync(`launchctl start ${this.label}`, { stdio: 'pipe' });
    }
  }

  async isActive(): Promise<boolean> {
    try {
      const output = execSync('launchctl list', { stdio: 'pipe' }).toString();
      for (const line of output.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts[parts.length - 1] === this.label) {
          const pid = line.trim().split(/\s+/)[0];
          return pid !== '-' && pid !== '' && !isNaN(Number(pid));
        }
      }
    } catch {
      // can't determine
    }
    return false;
  }

  async getLogs(lines: number): Promise<string> {
    try {
      return execSync(
        `log show --predicate 'processImagePath contains "convosketchpad"' --last 5m --info | tail -${lines}`,
        { stdio: 'pipe' },
      ).toString();
    } catch {
      return '';
    }
  }
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Detect the active service manager, or null if neither is found.
 * Tries systemd first, then launchd.
 */
export function detectServiceManager(): ServiceManager | null {
  const systemd = new SystemdManager();
  if (systemd.detect()) return systemd;

  const launchd = new LaunchdManager();
  if (launchd.detect()) return launchd;

  return null;
}
