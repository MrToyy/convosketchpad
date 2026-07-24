#!/usr/bin/env node

/**
 * convosketchpad-update — one-command updater for ConvoSketchpad.
 *
 * Usage:
 *   npm run update
 *   npm run update -- --version v0.2.0
 *   npm run update -- --dry-run
 *   npm run update -- --rollback
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { orchestrate, createReporter } from '../server/lib/updater/index.js';
import type { UpdateOptions } from '../server/lib/updater/index.js';

// ── Project root detection ───────────────────────────────────────────

function findProjectRoot(): string {
  // When run via `npm run update`, cwd is the project root.
  // Walk up from cwd looking for package.json as a safety net.
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

// ── Parse CLI args ───────────────────────────────────────────────────

function parseArgs(argv: string[]): UpdateOptions {
  const args = argv.slice(2);
  const options: UpdateOptions = {
    yes: false,
    dryRun: false,
    verbose: false,
    rollback: false,
    noRestart: false,
    cwd: findProjectRoot(),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--version': {
        const next = args[++i];
        if (!next || next.startsWith('-')) {
          process.stderr.write('Error: --version requires a value (e.g. --version v0.2.0)\n');
          process.exit(1);
        }
        options.version = next;
        break;
      }
      case '--yes':
      case '-y':
        options.yes = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--rollback':
        options.rollback = true;
        break;
      case '--no-restart':
        options.noRestart = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        process.stderr.write(`Unknown option: ${arg}\n`);
        printHelp();
        process.exit(1);
    }
  }

  return options;
}

function printHelp(): void {
  process.stderr.write(`
  Usage: convosketchpad-update [options]

  Options:
    --version <vX.Y.Z>  Pin to a specific version
    --yes, -y            Skip confirmation prompt
    --dry-run            Show what would happen without making changes
    --verbose, -v        Extra logging
    --rollback           Rollback to last-known-good snapshot
    --no-restart         Skip service restart and health checks
    --help, -h           Show this help

  Exit codes:
    0   Success
    1   Already up to date
    10  Preflight failure
    20  Version resolution failure
    40  Build failure
    50  Restart failure (rollback attempted)
    60  Health check failure (rollback attempted)
    70  Rollback failure (critical)
    80  Lock acquisition failure
`);
}

// ── Banner ───────────────────────────────────────────────────────────

function printBanner(): void {
  const DIM = '\x1b[2m';
  const ORANGE = '\x1b[38;5;208m';
  const NC = '\x1b[0m';

  process.stderr.write(`
  ${ORANGE}◆ ConvoSketchpad${NC} ${DIM}updater${NC}
`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseArgs(process.argv);
  const reporter = createReporter(options.verbose);

  printBanner();

  const exitCode = await orchestrate(options, reporter);
  process.exit(exitCode);
}

main().catch((err: unknown) => {
  process.stderr.write(`\nFatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
