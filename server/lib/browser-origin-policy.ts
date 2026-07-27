export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized === '0:0:0:0:0:0:0:1'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

export function normalizeConfiguredOrigin(value: string): string | null {
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

export function parseConfiguredOrigins(value: string | undefined): {
  origins: string[];
  invalid: string[];
} {
  const origins = new Set<string>();
  const invalid: string[] = [];
  for (const raw of (value || '').split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const normalized = normalizeConfiguredOrigin(trimmed);
    if (normalized) origins.add(normalized);
    else invalid.push(trimmed);
  }
  return { origins: [...origins], invalid };
}

export function hasRemoteConfiguredOrigin(origins: string[]): boolean {
  return origins.some(origin => !isLoopbackHostname(new URL(origin).hostname));
}
