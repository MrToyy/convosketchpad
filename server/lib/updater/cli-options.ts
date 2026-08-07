import type { UpdateOptions } from './types.js';

export interface ParsedUpdateCliOptions {
  options: UpdateOptions;
  help: boolean;
}

/** Reject option combinations whose apparent safety semantics would conflict. */
export function validateUpdateOptionCombination(options: UpdateOptions): string | null {
  if (!options.rollback) return null;
  const conflicts = [
    ...(options.dryRun ? ['--dry-run'] : []),
    ...(options.version ? ['--version'] : []),
    ...(options.noRestart ? ['--no-restart'] : []),
  ];
  if (conflicts.length === 0) return null;
  return `--rollback cannot be combined with ${conflicts.join(', ')}`;
}

export function parseUpdateCliOptions(args: string[], cwd: string): ParsedUpdateCliOptions {
  const options: UpdateOptions = {
    yes: false,
    dryRun: false,
    verbose: false,
    rollback: false,
    noRestart: false,
    cwd,
  };
  const seen = new Set<string>();
  let help = false;

  const markSeen = (canonical: string): void => {
    if (seen.has(canonical)) throw new Error(`Duplicate option: ${canonical}`);
    seen.add(canonical);
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--version': {
        markSeen('--version');
        const value = args[++i];
        if (!value || value.startsWith('-')) {
          throw new Error('--version requires a value (e.g. --version v0.4.0)');
        }
        options.version = value;
        break;
      }
      case '--yes':
      case '-y':
        markSeen('--yes');
        options.yes = true;
        break;
      case '--dry-run':
        markSeen('--dry-run');
        options.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        markSeen('--verbose');
        options.verbose = true;
        break;
      case '--rollback':
        markSeen('--rollback');
        options.rollback = true;
        break;
      case '--no-restart':
        markSeen('--no-restart');
        options.noRestart = true;
        break;
      case '--help':
      case '-h':
        markSeen('--help');
        help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (help && seen.size > 1) throw new Error('--help cannot be combined with other options');
  const combinationError = validateUpdateOptionCombination(options);
  if (combinationError) throw new Error(combinationError);
  return { options, help };
}
