/**
 * Prerequisite checker — verifies Node.js, npm, and Tailscale.
 */

import { execSync } from 'node:child_process';
import { success, warn, fail } from './banner.js';
import { getTailscaleState, type TailscaleState } from './tailscale.js';
import { isSupportedNodeVersion, MINIMUM_NODE_VERSION } from '../../server/lib/node-version.js';

export interface PrereqResult {
  nodeOk: boolean;
  nodeVersion: string;
  npmOk: boolean;
  tailscaleOk: boolean;
  tailscaleIp: string | null;
  tailscale: TailscaleState;
}

/** Check all prerequisites and print results. */
export function checkPrerequisites(opts?: { quiet?: boolean; nodeVersion?: string }): PrereqResult {
  const quiet = opts?.quiet ?? false;

  if (!quiet) console.log('  Checking prerequisites...');

  const nodeVersion = opts?.nodeVersion ?? process.version;
  const nodeOk = isSupportedNodeVersion(nodeVersion);

  if (!quiet) {
    if (nodeOk) success(`Node.js ${nodeVersion} (≥${MINIMUM_NODE_VERSION} required)`);
    else fail(`Node.js ${nodeVersion} — version ${MINIMUM_NODE_VERSION} or later is required`);
  }

  const npmOk = commandExists('npm');
  if (!quiet) {
    if (npmOk) success('npm available');
    else fail('npm not found');
  }

  const tailscale = getTailscaleState();
  const tailscaleOk = tailscale.installed;
  const tailscaleIp = tailscale.ipv4;
  if (!quiet && tailscaleOk) {
    if (tailscaleIp) success(`Tailscale detected (${tailscaleIp})`);
    else if (tailscale.authenticated && tailscale.dnsName) success(`Tailscale detected (${tailscale.dnsName})`);
    else warn('Tailscale installed but not connected');
  }

  return { nodeOk, nodeVersion, npmOk, tailscaleOk, tailscaleIp, tailscale };
}

/** Check if a command exists on the system. */
function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
