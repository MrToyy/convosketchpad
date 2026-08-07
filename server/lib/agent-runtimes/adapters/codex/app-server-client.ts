import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';
import { promisify } from 'node:util';
import type { RuntimeStatus } from '../../contract.js';
import { codexConfig, compareVersions, MINIMUM_CODEX_VERSION, parseCodexVersion } from './config.js';

const execFileAsync = promisify(execFile);

type JsonObject = Record<string, unknown>;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CodexRpcError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = 'CodexRpcError';
    this.code = code;
  }
}

export class CodexTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodexTransportError';
  }
}

export interface CodexServerRequest {
  id: string | number;
  method: string;
  params: JsonObject;
}

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private connecting: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<string | number, PendingRequest>();
  private readonly events = new EventEmitter();
  private version: string | undefined;
  private status: RuntimeStatus = { runtimeId: 'codex', state: 'disconnected' };
  private closed = false;
  private wantsConnection = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  getStatus(): RuntimeStatus {
    return this.status;
  }

  subscribeNotification(listener: (method: string, params: JsonObject) => void): () => void {
    this.events.on('notification', listener);
    return () => this.events.off('notification', listener);
  }

  subscribeServerRequest(listener: (request: CodexServerRequest) => void): () => void {
    this.events.on('serverRequest', listener);
    return () => this.events.off('serverRequest', listener);
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

  async connect(): Promise<void> {
    if (this.closed) throw new CodexTransportError('Codex App Server client is closed');
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

  private async detectVersion(): Promise<string> {
    const { stdout, stderr } = await execFileAsync(codexConfig.binary, ['--version'], {
      timeout: 5_000,
      encoding: 'utf8',
    });
    const version = parseCodexVersion(`${stdout}\n${stderr}`);
    if (!version) throw new CodexTransportError('Unable to parse Codex CLI version');
    if (compareVersions(version, MINIMUM_CODEX_VERSION) < 0) {
      throw new CodexTransportError(`Codex ${version} is unsupported; ${MINIMUM_CODEX_VERSION} or newer is required`);
    }
    return version;
  }

  private async open(): Promise<void> {
    this.setStatus({ runtimeId: 'codex', state: 'connecting' });
    try {
      this.version = await this.detectVersion();
      if (this.closed) throw new CodexTransportError('Codex App Server client is closed');
      const child = spawn(codexConfig.binary, ['app-server'], {
        cwd: codexConfig.workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
      this.child = child;
      const lines = readline.createInterface({ input: child.stdout });
      lines.on('line', (line) => this.receive(line));
      // Drain diagnostics without copying local paths or Runtime details into public status.
      child.stderr.resume();
      child.once('error', (error) => {
        if (this.child === child) this.disconnect(error.message, true);
      });
      child.once('exit', (code, signal) => {
        if (this.child !== child) return;
        this.disconnect(`Codex App Server exited (${signal || (code ?? 'unknown')})`, true);
      });
      await this.requestRaw('initialize', {
        clientInfo: {
          name: 'convosketchpad',
          title: 'ConvoSketchpad',
          version: process.env.npm_package_version || '0.4.2',
        },
      }, 10_000);
      this.notify('initialized', {});
      this.setStatus({
        runtimeId: 'codex',
        state: 'connected',
        version: this.version,
      });
      this.reconnectAttempt = 0;
    } catch (error) {
      this.disconnect(error instanceof Error ? error.message : String(error), true);
      throw error;
    }
  }

  private receive(line: string): void {
    let message: JsonObject;
    try {
      message = JSON.parse(line) as JsonObject;
    } catch {
      return;
    }
    if ('id' in message && !('method' in message)) {
      const id = message.id as string | number;
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      const error = message.error as JsonObject | undefined;
      if (error) pending.reject(new CodexRpcError(String(error.message || 'Codex RPC failed'), Number(error.code)));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.method !== 'string') return;
    const params = message.params && typeof message.params === 'object'
      ? message.params as JsonObject
      : {};
    if ('id' in message) {
      this.events.emit('serverRequest', {
        id: message.id as string | number,
        method: message.method,
        params,
      } satisfies CodexServerRequest);
    } else {
      this.events.emit('notification', message.method, params);
    }
  }

  private write(message: JsonObject): void {
    if (!this.child?.stdin.writable) throw new CodexTransportError('Codex App Server is not writable');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private requestRaw(method: string, params: JsonObject | null, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexTransportError(`Codex RPC timed out: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ method, id, ...(params === null ? {} : { params }) });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async request(method: string, params: JsonObject | null = null, timeoutMs = 30_000): Promise<unknown> {
    await this.connect();
    return this.requestRaw(method, params, timeoutMs);
  }

  notify(method: string, params: JsonObject): void {
    this.write({ method, params });
  }

  respond(id: string | number, result: unknown): void {
    this.write({ id, result });
  }

  respondError(id: string | number, code: number, message: string): void {
    this.write({ id, error: { code, message } });
  }

  async restart(): Promise<void> {
    if (this.closed) throw new CodexTransportError('Codex App Server client is closed');
    this.disconnect('Codex App Server restart requested', false);
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

  private disconnect(message: string, reconnect = false): void {
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill('SIGTERM');
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new CodexTransportError(message));
    }
    this.pending.clear();
    if (!this.closed) {
      this.setStatus({ runtimeId: 'codex', state: 'disconnected', error: message, ...(this.version ? { version: this.version } : {}) });
      if (reconnect) this.scheduleReconnect();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.wantsConnection = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill('SIGTERM');
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new CodexTransportError('Codex App Server client closed'));
    }
    this.pending.clear();
    this.setStatus({ runtimeId: 'codex', state: 'disconnected' });
    this.events.removeAllListeners();
  }
}
