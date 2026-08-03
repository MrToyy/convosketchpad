export interface ArtifactIdentityShape {
  runtimeArtifactId?: string;
  sourceUri?: string;
  uri: string;
  storage?: 'canvas' | 'external' | 'source';
  available?: boolean;
  warning?: string;
}

export function canonicalArtifactSource(value: string): string {
  try {
    const url = new URL(value, 'http://convosketchpad.invalid');
    if (url.origin === 'http://convosketchpad.invalid' && url.pathname === '/api/files') {
      const filePath = url.searchParams.get('path');
      if (filePath) return `file:${filePath}`;
    }
    if (url.protocol === 'file:') return `file:${decodeURIComponent(url.pathname)}`;
  } catch {
    // Preserve opaque Runtime source identifiers.
  }
  if (value.startsWith('/') && !value.startsWith('/api/')) return `file:${value}`;
  return value;
}

function artifactPreference(artifact: ArtifactIdentityShape): number {
  return (artifact.storage === 'canvas' ? 4 : 0)
    + (artifact.available !== false ? 2 : 0)
    + (artifact.warning ? 0 : 1);
}

export function mergeEquivalentArtifacts<T extends ArtifactIdentityShape>(artifacts: T[]): T[] {
  const merged = new Map<string, T>();
  for (const artifact of artifacts) {
    const key = artifact.runtimeArtifactId
      ? `runtime:${artifact.runtimeArtifactId}`
      : canonicalArtifactSource(artifact.sourceUri || artifact.uri);
    const existing = merged.get(key);
    if (!existing || artifactPreference(artifact) > artifactPreference(existing)) {
      merged.set(key, artifact);
    }
  }
  return [...merged.values()];
}
