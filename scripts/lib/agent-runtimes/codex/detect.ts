import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, resolve } from 'node:path';
import readline from 'node:readline';
import {
  compareVersions,
  MINIMUM_CODEX_VERSION,
  parseCodexVersion,
} from '../../../../server/lib/agent-runtimes/adapters/codex/setup-support.js';

export interface CodexRuntimeDetection {
  detected: boolean;
  command: string;
  resolvedBinary: string | null;
  version: string | null;
  supported: boolean;
  message: string;
}

function resolveCommandOnPath(command: string, pathValue = process.env.PATH || ''): string | null {
  const candidates = command.includes('/') || command.includes('\\')
    ? [isAbsolute(command) ? command : resolve(command)]
    : pathValue.split(delimiter).filter(Boolean).map((entry) => resolve(entry, command));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH in order.
    }
  }
  return null;
}

export function detectCodexRuntime(input: {
  configuredBin?: string;
  environment?: NodeJS.ProcessEnv;
} = {}): CodexRuntimeDetection {
  const environment = input.environment || process.env;
  const command = input.configuredBin || environment.CODEX_BIN || 'codex';
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    env: environment,
  });
  const notFound = result.error && 'code' in result.error && result.error.code === 'ENOENT';
  if (notFound) {
    return {
      detected: false,
      command,
      resolvedBinary: null,
      version: null,
      supported: false,
      message: `${command} was not found on PATH`,
    };
  }
  const version = parseCodexVersion(`${result.stdout || ''}\n${result.stderr || ''}`);
  const supported = Boolean(version && compareVersions(version, MINIMUM_CODEX_VERSION) >= 0);
  return {
    detected: true,
    command,
    resolvedBinary: resolveCommandOnPath(command, environment.PATH),
    version,
    supported,
    message: version
      ? supported
        ? `Codex CLI ${version} detected`
        : `Codex CLI ${version} detected; ${MINIMUM_CODEX_VERSION} or newer is required`
      : 'Codex command found but its version could not be verified',
  };
}

export async function probeCodexAccount(input: {
  binary: string;
  workingDirectory: string;
  timeoutMs?: number;
}): Promise<{ connected: boolean; loggedIn: boolean; message: string }> {
  const timeoutMs = input.timeoutMs || 12_000;
  const child = spawn(input.binary, ['app-server'], {
    cwd: input.workingDirectory,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });
  const lines = readline.createInterface({ input: child.stdout });
  child.stderr.resume();
  let nextId = 1;
  const pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  let stopped = false;
  const failPending = (error: Error) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  };
  const cleanup = () => {
    stopped = true;
    lines.close();
    if (!child.killed) child.kill('SIGTERM');
  };
  const request = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    const id = nextId++;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex App Server ${method} probe timed out`));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve: resolvePromise, reject, timer });
      child.stdin.write(`${JSON.stringify({ method, id, params })}\n`, (error) => {
        if (!error) return;
        const waiter = pending.get(id);
        if (!waiter) return;
        pending.delete(id);
        clearTimeout(waiter.timer);
        waiter.reject(error);
      });
    });
  };
  child.once('error', (error) => failPending(error));
  child.once('exit', (code, signal) => {
    if (!stopped) failPending(new Error(`Codex App Server exited (${signal || (code ?? 'unknown')})`));
  });
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
      if (message.id === undefined) return;
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(message.error.message || 'Codex App Server request failed'));
      else waiter.resolve(message.result);
    } catch {
      // Ignore non-protocol output.
    }
  });
  try {
    await request('initialize', {
      clientInfo: { name: 'convosketchpad_setup', title: 'ConvoSketchpad Setup', version: '0.4.0' },
    });
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
    const result = await request('account/read', { refreshToken: false }) as {
      account?: unknown;
      requiresOpenaiAuth?: boolean;
    };
    const loggedIn = result.requiresOpenaiAuth !== true || Boolean(result.account);
    return {
      connected: true,
      loggedIn,
      message: loggedIn ? 'Codex App Server is ready' : 'Codex is not logged in',
    };
  } catch (error) {
    return { connected: false, loggedIn: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    cleanup();
  }
}
