import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { promisify } from 'node:util';
import type { RuntimeStatus } from '../../contract.js';
import {
  MINIMUM_OPENCODE_VERSION,
  compareOpenCodeVersions,
  openCodeConfig,
  parseOpenCodeVersion,
} from './config.js';

const execFileAsync = promisify(execFile);
type UnknownRecord = Record<string, unknown>;

export class OpenCodeHttpError extends Error {
  readonly status: number;
  readonly responseBody?: unknown;

  constructor(status: number, message: string, responseBody?: unknown) {
    super(message);
    this.name = 'OpenCodeHttpError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class OpenCodeTransportError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'OpenCodeTransportError';
    this.cause = cause;
  }
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function sanitizedErrorBody(value: unknown): string {
  const source = typeof value === 'string' ? value : JSON.stringify(value);
  return (source || 'OpenCode request failed')
    .slice(0, 4_000)
    .replace(/((?:api[_-]?key|token|password|secret|authorization)\s*[=:]\s*)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[REDACTED]@');
}

export class OpenCodeServerClient {
  private readonly portAllocator: () => Promise<number>;
  private child: ChildProcessWithoutNullStreams | null = null;
  private connecting: Promise<void> | null = null;
  private readonly events = new EventEmitter();
  private status: RuntimeStatus = { runtimeId: 'opencode', state: 'disconnected' };
  private closed = false;
  private wantsConnection = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private baseUrl = '';
  private username = '';
  private password = '';
  private version: string | undefined;
  private eventAbort: AbortController | null = null;

  constructor(portAllocator: () => Promise<number> = availablePort) {
    this.portAllocator = portAllocator;
  }

  getStatus(): RuntimeStatus { return this.status; }

  subscribeEvent(listener: (event: UnknownRecord) => void): () => void {
    this.events.on('event', listener);
    return () => this.events.off('event', listener);
  }

  subscribeStatus(listener: (status: RuntimeStatus) => void): () => void {
    this.events.on('status', listener);
    listener(this.status);
    return () => this.events.off('status', listener);
  }

  private setStatus(status: RuntimeStatus): void {
    this.status = status;
    this.events.emit('status', status);
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
  }

  private async detectVersion(): Promise<string> {
    const { stdout, stderr } = await execFileAsync(openCodeConfig.binary, ['--version'], {
      timeout: 5_000,
      encoding: 'utf8',
    });
    const version = parseOpenCodeVersion(`${stdout}\n${stderr}`);
    if (!version) throw new OpenCodeTransportError('Unable to parse OpenCode CLI version');
    if (compareOpenCodeVersions(version, MINIMUM_OPENCODE_VERSION) < 0) {
      throw new OpenCodeTransportError(`OpenCode ${version} is unsupported; ${MINIMUM_OPENCODE_VERSION} or newer is required`);
    }
    return version;
  }

  async connect(): Promise<void> {
    if (this.closed) throw new OpenCodeTransportError('OpenCode Server client is closed');
    this.wantsConnection = true;
    if (this.child && this.status.state === 'connected') return;
    if (this.connecting) return this.connecting;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connecting = this.open().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async open(): Promise<void> {
    this.setStatus({ runtimeId: 'opencode', state: 'connecting' });
    try {
      this.version = await this.detectVersion();
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await this.spawnServer(await this.portAllocator());
          this.reconnectAttempt = 0;
          this.setStatus({ runtimeId: 'opencode', state: 'connected', version: this.version });
          void this.consumeEvents();
          return;
        } catch (error) {
          lastError = error;
          this.stopChild();
        }
      }
      throw lastError;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.disconnect(message, true);
      throw error;
    }
  }

  private async spawnServer(port: number): Promise<void> {
    if (this.closed) throw new OpenCodeTransportError('OpenCode Server client is closed');
    this.username = `convosketchpad-${randomBytes(8).toString('hex')}`;
    this.password = randomBytes(32).toString('base64url');
    this.baseUrl = `http://127.0.0.1:${port}`;
    const child = spawn(openCodeConfig.binary, [
      'serve', '--hostname', '127.0.0.1', '--port', String(port), '--log-level', 'ERROR',
    ], {
      cwd: openCodeConfig.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: {
        ...process.env,
        OPENCODE_SERVER_USERNAME: this.username,
        OPENCODE_SERVER_PASSWORD: this.password,
        OPENCODE_DISABLE_AUTOUPDATE: 'true',
      },
    });
    this.child = child;
    child.stdin.end();
    child.stdout.resume();
    child.stderr.resume();
    child.once('error', (error) => {
      if (this.child === child) this.disconnect(error.message, true);
    });
    child.once('exit', (code, signal) => {
      if (this.child === child) this.disconnect(`OpenCode Server exited (${signal || (code ?? 'unknown')})`, true);
    });
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      if (this.child !== child || child.exitCode !== null) throw new OpenCodeTransportError('OpenCode Server exited before becoming ready');
      try {
        const health = await this.requestRaw('GET', '/global/health', undefined, 1_000, false) as UnknownRecord;
        if (health.healthy === true) return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new OpenCodeTransportError('OpenCode Server health check timed out');
  }

  private scopedPath(pathname: string): string {
    if (pathname.startsWith('/global/')) return pathname;
    const separator = pathname.includes('?') ? '&' : '?';
    return `${pathname}${separator}directory=${encodeURIComponent(openCodeConfig.workingDirectory)}`;
  }

  private async requestRaw(method: string, pathname: string, body: unknown, timeoutMs: number, scoped = true): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await fetch(`${this.baseUrl}${scoped ? this.scopedPath(pathname) : pathname}`, {
        method,
        headers: {
          authorization: this.authHeader(),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        let parsed: unknown = text;
        try { parsed = text ? JSON.parse(text) : undefined; } catch { /* retain text */ }
        throw new OpenCodeHttpError(response.status, sanitizedErrorBody(parsed), parsed);
      }
      if (response.status === 204) return undefined;
      const text = await response.text();
      return text ? JSON.parse(text) : undefined;
    } catch (error) {
      if (error instanceof OpenCodeHttpError) throw error;
      throw new OpenCodeTransportError(
        error instanceof Error && error.name === 'AbortError'
          ? `OpenCode ${method} ${pathname} timed out`
          : `OpenCode ${method} ${pathname} failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async request(method: string, pathname: string, body?: unknown, timeoutMs = 30_000): Promise<unknown> {
    await this.connect();
    return this.requestRaw(method, pathname, body, timeoutMs);
  }

  private async consumeEvents(): Promise<void> {
    const child = this.child;
    const controller = new AbortController();
    this.eventAbort?.abort();
    this.eventAbort = controller;
    try {
      const response = await fetch(`${this.baseUrl}${this.scopedPath('/event')}`, {
        headers: { authorization: this.authHeader(), accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`OpenCode event stream returned ${response.status}`);
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const payload = frame.split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (payload) {
            try { this.events.emit('event', JSON.parse(payload) as UnknownRecord); } catch { /* ignore malformed event */ }
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
      if (!controller.signal.aborted && this.child === child) throw new Error('OpenCode event stream closed');
    } catch (error) {
      if (controller.signal.aborted || this.closed || this.child !== child) return;
      this.disconnect(error instanceof Error ? error.message : String(error), true);
    }
  }

  async restart(): Promise<void> {
    if (this.closed) throw new OpenCodeTransportError('OpenCode Server client is closed');
    this.disconnect('OpenCode Server restart requested', false);
    await this.connect();
  }

  private scheduleReconnect(): void {
    if (this.closed || !this.wantsConnection || this.reconnectTimer) return;
    const delay = Math.min(30_000, 1_000 * (2 ** this.reconnectAttempt));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => undefined);
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private stopChild(): void {
    this.eventAbort?.abort();
    this.eventAbort = null;
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill('SIGTERM');
  }

  private disconnect(message: string, reconnect: boolean): void {
    this.stopChild();
    if (!this.closed) {
      this.setStatus({ runtimeId: 'opencode', state: 'disconnected', error: message, ...(this.version ? { version: this.version } : {}) });
      if (reconnect) this.scheduleReconnect();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.wantsConnection = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopChild();
    this.setStatus({ runtimeId: 'opencode', state: 'disconnected' });
    this.events.removeAllListeners();
  }
}
