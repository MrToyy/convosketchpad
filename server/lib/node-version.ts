export const MINIMUM_NODE_VERSION = '22.22.2';

function parseNodeVersion(value: string): [number, number, number] | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isSupportedNodeVersion(value: string): boolean {
  const current = parseNodeVersion(value);
  const minimum = parseNodeVersion(MINIMUM_NODE_VERSION);
  if (!current || !minimum) return false;

  for (let index = 0; index < current.length; index++) {
    if (current[index] !== minimum[index]) return current[index] > minimum[index];
  }
  return true;
}
