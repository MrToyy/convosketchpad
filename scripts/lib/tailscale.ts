import { execSync } from 'node:child_process';

export interface TailscaleState {
  installed: boolean;
  authenticated: boolean;
  ipv4: string | null;
  dnsName: string | null;
  serveOrigins: string[];
  serveRoutes: TailscaleServeRoute[];
}

export interface TailscaleServeRoute {
  origin: string;
  proxyTargets: string[];
}

type ExecLike = (command: string, options?: Record<string, unknown>) => string | Buffer;

function toText(value: string | Buffer): string {
  return typeof value === 'string' ? value : value.toString('utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function findFirstIpv4(values: unknown): string | null {
  if (!Array.isArray(values)) return null;
  for (const value of values) {
    if (typeof value === 'string' && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value.trim())) {
      return value.trim();
    }
  }
  return null;
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

export function normalizeDnsName(value: string | null | undefined): string | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
}

export function extractServeRoutes(json: unknown): TailscaleServeRoute[] {
  if (!isRecord(json) || !isRecord(json.Web)) return [];

  const routes = new Map<string, Set<string>>();
  for (const [rawKey, rawConfig] of Object.entries(json.Web)) {
    const key = rawKey.trim();
    if (!key) continue;

    const portMatch = key.match(/:(\d+)$/);
    const port = portMatch?.[1] || null;
    const hostPart = portMatch ? key.slice(0, -portMatch[0].length) : key;
    const host = normalizeDnsName(hostPart);
    if (!host) continue;

    let origin: string;
    if (port === '80') {
      origin = `http://${host}`;
    } else if (!port || port === '443') {
      origin = `https://${host}`;
    } else {
      origin = `https://${host}:${port}`;
    }
    try {
      origin = new URL(origin).origin;
    } catch {
      continue;
    }

    const targets = routes.get(origin) || new Set<string>();
    if (isRecord(rawConfig) && isRecord(rawConfig.Handlers)) {
      for (const handler of Object.values(rawConfig.Handlers)) {
        if (!isRecord(handler) || typeof handler.Proxy !== 'string') continue;
        const target = handler.Proxy.trim();
        if (target) targets.add(target);
      }
    }
    routes.set(origin, targets);
  }

  return [...routes].map(([origin, proxyTargets]) => ({
    origin,
    proxyTargets: [...proxyTargets],
  }));
}

export function extractServeOrigins(json: unknown): string[] {
  return extractServeRoutes(json).map(route => route.origin);
}

export function parseTailscaleStatus(json: unknown): Pick<TailscaleState, 'authenticated' | 'ipv4' | 'dnsName'> {
  if (!isRecord(json) || !isRecord(json.Self)) {
    return {
      authenticated: false,
      ipv4: null,
      dnsName: null,
    };
  }

  const self = json.Self;
  const dnsName = normalizeDnsName(typeof self.DNSName === 'string' ? self.DNSName : null);
  const ipv4 = findFirstIpv4(self.TailscaleIPs);

  return {
    authenticated: Boolean(ipv4 || dnsName),
    ipv4,
    dnsName,
  };
}

export function getTailscaleState(exec: ExecLike = execSync): TailscaleState {
  try {
    exec('command -v tailscale', { stdio: 'pipe', timeout: 3000 });
  } catch {
    return {
      installed: false,
      authenticated: false,
      ipv4: null,
      dnsName: null,
      serveOrigins: [],
      serveRoutes: [],
    };
  }

  let status: Pick<TailscaleState, 'authenticated' | 'ipv4' | 'dnsName'> = {
    authenticated: false,
    ipv4: null,
    dnsName: null,
  };
  let serveOrigins: string[] = [];
  let serveRoutes: TailscaleServeRoute[] = [];

  try {
    const statusJson = parseJson(toText(exec('tailscale status --json 2>/dev/null', { stdio: 'pipe', timeout: 3000 })));
    status = parseTailscaleStatus(statusJson);
  } catch {
    // leave default unauthenticated state
  }

  try {
    const serveJson = parseJson(toText(exec('tailscale serve status --json 2>/dev/null', { stdio: 'pipe', timeout: 3000 })));
    serveRoutes = extractServeRoutes(serveJson);
    serveOrigins = serveRoutes.map(route => route.origin);
  } catch {
    // serve may be inactive or unsupported
  }

  return {
    installed: true,
    authenticated: status.authenticated,
    ipv4: status.ipv4,
    dnsName: status.dnsName,
    serveOrigins,
    serveRoutes,
  };
}
