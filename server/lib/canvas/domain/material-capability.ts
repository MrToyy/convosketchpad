import type { RuntimeCapabilities } from '../../agent-runtimes/contract.js';

export function runtimeAcceptsMimeType(
  capabilities: RuntimeCapabilities,
  mimeType: string,
): boolean {
  if (mimeType.startsWith('image/')) return capabilities.input.images;
  if (mimeType.startsWith('audio/')) return capabilities.input.audio;
  return capabilities.input.arbitraryFiles;
}
