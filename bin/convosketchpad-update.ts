#!/usr/bin/env node

/**
 * convosketchpad-update — one-command updater for ConvoSketchpad.
 *
 * Usage:
 *   npm run update
 *   npm run update -- --version v0.4.2
 *   npm run update -- --dry-run
 *   npm run update -- --rollback
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { orchestrate, createReporter } from '../server/lib/updater/index.js';
import { parseUpdateCliOptions } from '../server/lib/updater/cli-options.js';

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

function printHelp(): void {
  process.stderr.write(`
  Usage: convosketchpad-update [options]

  Options:
    --version <vX.Y.Z>  Pin to a specific version
    --yes, -y            Skip confirmation prompt
    --dry-run            Show what would happen without making changes
    --verbose, -v        Extra logging
    --rollback           Rollback to last-known-good snapshot
    --resume             Recover an interrupted transaction and continue its target update
    --status             Show the active or most recent update transaction
    --no-restart         Do not manage the service; skip DB migration and health checks
    --leave-stopped      Complete the offline migration but preserve the service stopped
    --help, -h           Show this help

  Exit codes:
    0   Success
    1   Already up to date or invalid CLI arguments
    10  Preflight failure
    20  Version resolution failure
    40  Build failure
    45  Database migration failure
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
  let parsed;
  try {
    parsed = parseUpdateCliOptions(process.argv.slice(2), findProjectRoot());
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    printHelp();
    process.exit(1);
  }
  if (parsed.help) {
    printHelp();
    return;
  }
  const options = parsed.options;
  const reporter = createReporter(options.verbose);

  printBanner();

  const exitCode = await orchestrate(options, reporter);
  process.exit(exitCode);
}

main().catch((err: unknown) => {
  process.stderr.write(`\nFatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
