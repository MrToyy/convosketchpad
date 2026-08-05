export type SetupAccessMode =
  | 'local'
  | 'network'
  | 'custom'
  | 'tailscale-ip'
  | 'tailscale-serve';

export interface SetupCliOptions {
  help: boolean;
  check: boolean;
  defaults: boolean;
  runtimeIds: string[] | null;
  defaultAgent: { runtimeId: string; profileId: string } | null;
  accessMode?: SetupAccessMode;
  gatewayTimezone?: string;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`);
  return value;
}

function parseAccessMode(value: string): SetupAccessMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'tailscale') return 'tailscale-ip';
  if (
    normalized === 'local'
    || normalized === 'network'
    || normalized === 'custom'
    || normalized === 'tailscale-ip'
    || normalized === 'tailscale-serve'
  ) return normalized;
  throw new Error(`Invalid --access-mode value: ${value}`);
}

function parseRuntimeIds(value: string, supportedRuntimeIds: readonly string[]): string[] {
  const ids = value.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (ids.length === 0) throw new Error('--runtimes must include at least one Runtime');
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    throw new Error(`--runtimes contains duplicate value(s): ${[...new Set(duplicates)].join(', ')}`);
  }
  const supported = new Set(supportedRuntimeIds);
  const unsupported = ids.filter((id) => !supported.has(id));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported --runtimes value(s): ${unsupported.join(', ')}`);
  }
  return ids;
}

export function parseDefaultAgentRef(value: string): { runtimeId: string; profileId: string } {
  const separator = value.indexOf('/');
  const runtimeId = value.slice(0, separator).trim().toLowerCase();
  const profileId = value.slice(separator + 1).trim();
  if (separator <= 0 || !runtimeId || !profileId) {
    throw new Error('--default-agent must use the form <runtime-id>/<profile-id>');
  }
  return { runtimeId, profileId };
}

export function parseSetupCliOptions(
  args: string[],
  supportedRuntimeIds: readonly string[],
): SetupCliOptions {
  const options: SetupCliOptions = {
    help: false,
    check: false,
    defaults: false,
    runtimeIds: null,
    defaultAgent: null,
  };
  const seen = new Set<string>();

  const markSeen = (canonical: string): void => {
    if (seen.has(canonical)) throw new Error(`Duplicate option: ${canonical}`);
    seen.add(canonical);
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    switch (arg) {
      case '--help':
      case '-h':
        markSeen('--help');
        options.help = true;
        break;
      case '--check':
        markSeen(arg);
        options.check = true;
        break;
      case '--defaults':
        markSeen(arg);
        options.defaults = true;
        break;
      case '--runtimes': {
        markSeen(arg);
        const value = requireValue(args, index, arg);
        options.runtimeIds = parseRuntimeIds(value, supportedRuntimeIds);
        index++;
        break;
      }
      case '--default-agent': {
        markSeen(arg);
        options.defaultAgent = parseDefaultAgentRef(requireValue(args, index, arg));
        index++;
        break;
      }
      case '--access-mode': {
        markSeen(arg);
        options.accessMode = parseAccessMode(requireValue(args, index, arg));
        index++;
        break;
      }
      case '--gateway-timezone': {
        markSeen(arg);
        options.gatewayTimezone = requireValue(args, index, arg).trim();
        index++;
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.help && seen.size > 1) {
    throw new Error('--help cannot be combined with other options');
  }
  if (options.check && seen.size > 1) {
    throw new Error('--check cannot be combined with configuration options');
  }
  if (options.accessMode && !options.defaults) {
    throw new Error('--access-mode requires --defaults');
  }
  if (options.defaultAgent && !supportedRuntimeIds.includes(options.defaultAgent.runtimeId)) {
    throw new Error(`Unsupported default Agent Runtime: ${options.defaultAgent.runtimeId}`);
  }
  return options;
}
