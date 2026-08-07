/** Resolve the OpenClaw command without guessing installation-specific paths. */
export function resolveOpenclawBin(explicit = process.env.OPENCLAW_BIN): string {
  return explicit?.trim() || 'openclaw';
}
