import type { EnvConfig } from './env-writer.js';
import type { TailscaleState } from './tailscale.js';

export type InstallerAccessProfile =
  | 'local'
  | 'network'
  | 'custom'
  | 'tailscale-ip'
  | 'tailscale-serve';

export interface AccessPlan {
  profile: InstallerAccessProfile;
  bindHost: string;
  browserOrigins: string[];
  trustedProxies: string[];
  remoteAccess: boolean;
  followUpSteps: string[];
}

export interface BuildAccessPlanInput {
  profile: InstallerAccessProfile;
  port: string;
  remoteHost?: string | null;
  browserOrigins?: string[];
  trustedProxies?: string[];
  tailscale?: TailscaleState;
}

function dedupe(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value)))];
}

export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return true;
  // Node's URL.hostname returns bracketed IPv6 literals (e.g. "[::1]"); strip
  // the brackets before comparing. Also accept any 127.0.0.0/8 IPv4 loopback
  // and the expanded IPv6 form.
  let normalized = host.trim().toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized === '0:0:0:0:0:0:0:1'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function httpOrigin(host: string, port: string): string {
  return `http://${host}:${port}`;
}

function emptyPlan(profile: InstallerAccessProfile, bindHost: string): AccessPlan {
  return {
    profile,
    bindHost,
    browserOrigins: [],
    trustedProxies: [],
    remoteAccess: !isLoopbackHost(bindHost),
    followUpSteps: [],
  };
}

export function normalizeBrowserOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null') return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || parsed.hostname.includes('*')) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function parseBrowserOrigins(value: string): string[] | null {
  const items = value.split(',').map(item => item.trim()).filter(Boolean);
  if (items.length === 0) return null;
  const normalized = items.map(normalizeBrowserOrigin);
  if (normalized.some(item => item === null)) return null;
  return dedupe(normalized);
}

export function isLoopbackBrowserOrigin(origin: string): boolean {
  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function buildAccessPlan(input: BuildAccessPlanInput): AccessPlan {
  const port = input.port;
  const tailscale = input.tailscale;

  switch (input.profile) {
    case 'local':
      return emptyPlan('local', '127.0.0.1');

    case 'network': {
      const host = input.remoteHost?.trim() || '';
      const plan = emptyPlan('network', '0.0.0.0');
      if (!host) {
        plan.followUpSteps.push('Provide a reachable LAN IP address for network mode.');
        return plan;
      }
      const origin = httpOrigin(host, port);
      plan.browserOrigins = [origin];
      plan.remoteAccess = true;
      return plan;
    }

    case 'custom': {
      const host = input.remoteHost?.trim() || '127.0.0.1';
      const plan = emptyPlan('custom', host);
      plan.browserOrigins = dedupe(input.browserOrigins || []);
      plan.trustedProxies = dedupe(input.trustedProxies || []);
      plan.remoteAccess = !isLoopbackHost(host)
        || plan.browserOrigins.some(origin => !isLoopbackBrowserOrigin(origin));
      return plan;
    }

    case 'tailscale-ip': {
      const ip = tailscale?.ipv4;
      if (!ip) {
        const plan = emptyPlan('tailscale-ip', '127.0.0.1');
        plan.followUpSteps.push('Connect Tailscale and obtain a tailnet IPv4 address, then re-run setup.');
        return plan;
      }
      const plan = emptyPlan('tailscale-ip', ip);
      const origin = httpOrigin(ip, port);
      plan.browserOrigins = [origin];
      plan.remoteAccess = true;
      return plan;
    }

    case 'tailscale-serve': {
      const plan = emptyPlan('tailscale-serve', '127.0.0.1');
      const origins = tailscale?.serveRoutes
        ?.filter(route => route.proxyTargets.some(target => {
          try {
            const parsed = new URL(target);
            return parsed.protocol === 'http:'
              && isLoopbackHost(parsed.hostname)
              && (parsed.port || '80') === port;
          } catch {
            return false;
          }
        }))
        .map(route => route.origin) || [];
      const origin = origins[0] || null;
      if (!origin) {
        plan.followUpSteps = dedupe([
          `Run: tailscale serve --bg http://127.0.0.1:${port}`,
          'Confirm Tailscale Serve exposes a usable https://<node>.tail<id>.ts.net origin, then re-run setup.',
        ]);
        return plan;
      }
      plan.browserOrigins = dedupe(origins);
      plan.remoteAccess = true;
      return plan;
    }
  }
}

export function applyAccessPlanToConfig(config: EnvConfig, plan: AccessPlan): EnvConfig {
  const next: EnvConfig = {
    ...config,
    HOST: plan.bindHost,
  };

  if (plan.browserOrigins.length > 0) next.ALLOWED_ORIGINS = dedupe(plan.browserOrigins).join(',');
  else delete next.ALLOWED_ORIGINS;
  if (plan.trustedProxies.length > 0) next.TRUSTED_PROXIES = dedupe(plan.trustedProxies).join(',');
  else delete next.TRUSTED_PROXIES;
  return next;
}
