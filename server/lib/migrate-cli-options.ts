export interface MigrateCliOptions {
  envOnly: boolean;
  rescanMedia: boolean;
  confirmOffline: boolean;
  help: boolean;
}

export function parseMigrateCliOptions(args: string[]): MigrateCliOptions {
  const supported = new Set(['--env-only', '--rescan-media', '--confirm-offline', '--help', '-h']);
  const unknown = args.filter((arg) => !supported.has(arg));
  if (unknown.length > 0) throw new Error(`Unknown option(s): ${unknown.join(', ')}`);
  const canonical = args.map((arg) => arg === '-h' ? '--help' : arg);
  const duplicates = canonical.filter((arg, index) => canonical.indexOf(arg) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate option(s): ${[...new Set(duplicates)].join(', ')}`);
  }

  const envOnly = canonical.includes('--env-only');
  const rescanMedia = canonical.includes('--rescan-media');
  const confirmOffline = canonical.includes('--confirm-offline');
  const help = canonical.includes('--help');
  if (help && canonical.length > 1) throw new Error('--help cannot be combined with migration options');
  if (envOnly && rescanMedia) throw new Error('--env-only cannot be combined with --rescan-media');
  if (envOnly && confirmOffline) throw new Error('--env-only cannot be combined with --confirm-offline');
  return { envOnly, rescanMedia, confirmOffline, help };
}
