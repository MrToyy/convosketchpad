#!/usr/bin/env node

/** ConvoSketchpad managed-user administration CLI. */

import { CanvasStore } from '../server/lib/canvas-db.js';
import { config } from '../server/lib/config.js';
import { createManagedUser, rotateManagedToken } from '../server/lib/user-management.js';

interface ParsedArgs {
  command: string;
  name?: string;
  token?: string;
}

function printHelp(): void {
  process.stdout.write(`
Usage: npm run users -- <command>

Commands:
  add <name> [--token <token>]      Add an allowed user
  list                              List managed users
  rotate <name> [--token <token>]  Rotate a user's token
  disable <name>                    Disable a user and revoke sessions
  enable <name>                     Enable a disabled user
  help                              Show this help

If --token is omitted for add/rotate, a random token is generated and shown once.
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const command = args.shift() || 'help';
  if (command === 'list' || command === 'help' || command === '--help' || command === '-h') {
    if (args.length) throw new Error('unexpected_arguments');
    return { command: command.startsWith('-') ? 'help' : command };
  }
  const name = args.shift();
  let token: string | undefined;
  while (args.length) {
    const option = args.shift();
    if (option === '--token') {
      token = args.shift();
      if (token === undefined) throw new Error('token_option_requires_value');
    } else {
      throw new Error(`unknown_option:${option}`);
    }
  }
  return { command, name, token };
}

function explainError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const messages: Record<string, string> = {
    user_exists: 'A user with that name already exists.',
    user_not_found: 'Managed user not found.',
    user_name_required: 'A user name is required.',
    user_name_too_long: 'User name must be 120 characters or fewer.',
    token_required: 'Token cannot be empty.',
    token_too_long: 'Token must be 256 characters or fewer.',
    token_exists: 'That token is already assigned to another user.',
    token_option_requires_value: '--token requires a value.',
    unexpected_arguments: 'This command does not accept arguments.',
  };
  return messages[message] || (message.startsWith('unknown_option:') ? `Unknown option: ${message.slice(15)}` : message);
}

async function main(): Promise<void> {
  let parsed: ParsedArgs;
  try { parsed = parseArgs(process.argv); }
  catch (error) {
    process.stderr.write(`Error: ${explainError(error)}\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (parsed.command === 'help') { printHelp(); return; }
  const store = new CanvasStore(config.canvasDatabasePath);
  try {
    if (parsed.command === 'list') {
      const users = store.listManagedUsers();
      if (!users.length) {
        process.stdout.write('No managed users.\n');
        return;
      }
      process.stdout.write(`${'NAME'.padEnd(24)} ${'STATUS'.padEnd(10)} ${'CANVASES'.padEnd(9)} UPDATED\n`);
      for (const user of users) {
        process.stdout.write(`${user.displayName.slice(0, 23).padEnd(24)} ${user.status.padEnd(10)} ${String(user.canvasCount).padEnd(9)} ${new Date(user.updatedAt).toISOString()}\n`);
      }
      return;
    }

    if (!parsed.name) throw new Error('user_name_required');
    if (parsed.command === 'add') {
      const result = await createManagedUser(parsed.name, parsed.token, store);
      process.stdout.write(`User added: ${result.user.displayName}\nToken: ${result.token}\n`);
      if (result.claimedCanvasCount > 0) process.stdout.write(`Claimed ${result.claimedCanvasCount} Local User canvas(es).\n`);
      process.stdout.write('Save this token now; it cannot be displayed later.\n');
      return;
    }
    if (parsed.command === 'rotate') {
      const result = await rotateManagedToken(parsed.name, parsed.token, store);
      process.stdout.write(`Token rotated for: ${result.user.displayName}\nToken: ${result.token}\nSave this token now; it cannot be displayed later.\n`);
      return;
    }
    if (parsed.token !== undefined) throw new Error(`unknown_option:--token`);
    if (parsed.command === 'disable' || parsed.command === 'enable') {
      const status = parsed.command === 'disable' ? 'disabled' : 'active';
      const user = store.setManagedUserStatus(parsed.name, status);
      process.stdout.write(`User ${status}: ${user.displayName}\n`);
      return;
    }
    throw new Error(`unknown_command:${parsed.command}`);
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith('unknown_command:')
      ? `Unknown command: ${error.message.slice(16)}`
      : explainError(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

void main();
