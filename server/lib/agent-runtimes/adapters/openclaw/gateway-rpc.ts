/**
 * Shared gateway RPC client.
 *
 * Sole OpenClaw transport for ConvoSketchpad. Uses one persistent backend
 * connection for RPC calls and native event subscription.
 *
 * Browser code never imports or implements this protocol.
 * @module
 */

import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { openClawConfig } from './config.js';
import {
  clearStoredDeviceAuth,
  CONVOSKETCHPAD_OPERATOR_SCOPES,
  createDeviceBlock,
  getStoredDeviceAuth,
  storeDeviceAuth,
} from './device-identity.js';
import { packageMetadata } from '../../../package-metadata.js';
import {
  CONVOSKETCHPAD_GATEWAY_CLIENT_ID,
  CONVOSKETCHPAD_GATEWAY_CLIENT_MODE,
  CONVOSKETCHPAD_GATEWAY_CLIENT_PLATFORM,
  gatewayConnectionMode,
  type GatewayConnectionMode,
} from './gateway-client-identity.js';

// ── Types ────────────────────────────────────────────────────────────

export interface GatewayCapabilities {
  serverVersion?: string;
  methods: ReadonlySet<string>;
  maxPayload?: number;
}

export class GatewayRpcError extends Error {
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'GatewayRpcError';
    this.code = typeof details?.code === 'string' ? details.code : undefined;
    this.details = details;
  }
}

export type GatewayDispatchFailureKind = 'not_sent' | 'outcome_unknown' | 'rejected';

export class GatewayDispatchError extends Error {
  readonly kind: GatewayDispatchFailureKind;

  constructor(kind: GatewayDispatchFailureKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'GatewayDispatchError';
  }
}

export interface GatewayRuntimeStatus {
  state: 'disconnected' | 'connecting' | 'connected';
  gatewayRestartSupported: boolean;
  error?: string;
  serverVersion?: string;
  methods: string[];
  maxPayload?: number;
}

export interface GatewayEvent {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
}

// ── Persistent connection ────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

/** Derive the WebSocket URL from the HTTP gateway URL. */
function getGatewayWsUrl(): string {
  const httpUrl = openClawConfig.gatewayUrl;
  let wsUrl: string;
  if (httpUrl.startsWith('ws://') || httpUrl.startsWith('wss://')) {
    wsUrl = httpUrl;
  } else {
    wsUrl = httpUrl.replace(/^http/, 'ws');
  }
  if (!wsUrl.endsWith('/ws')) {
    wsUrl = wsUrl.replace(/\/$/, '') + '/ws';
  }
  return wsUrl;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
  frameSent: boolean;
  classifyDispatch: boolean;
}

let ws: WebSocket | null = null;
let connected = false;
let connecting = false;
const pending = new Map<string, PendingCall>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let connectPromise: Promise<void> | null = null;
let connectResolve: (() => void) | null = null;
let connectReject: ((err: Error) => void) | null = null;
let deviceTokenRetryUsed = false;
let capabilities: GatewayCapabilities = { methods: new Set() };
let shuttingDown = false;
let lastConnectionError = '';
const eventSubscribers = new Set<(event: GatewayEvent) => void>();
const statusSubscribers = new Set<(status: GatewayRuntimeStatus) => void>();

function runtimeStatus(): GatewayRuntimeStatus {
  return {
    state: connected ? 'connected' : connecting ? 'connecting' : 'disconnected',
    gatewayRestartSupported: gatewayConnectionMode(openClawConfig.gatewayUrl) === 'loopback',
    ...(lastConnectionError ? { error: lastConnectionError } : {}),
    ...(capabilities.serverVersion ? { serverVersion: capabilities.serverVersion } : {}),
    methods: [...capabilities.methods],
    ...(capabilities.maxPayload ? { maxPayload: capabilities.maxPayload } : {}),
  };
}

function emitStatus(): void {
  const status = runtimeStatus();
  for (const subscriber of statusSubscribers) {
    try {
      subscriber(status);
    } catch (error) {
      statusSubscribers.delete(subscriber);
      console.warn(
        '[gateway-rpc] Removed failed status subscriber:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function scheduleReconnect(): void {
  if (shuttingDown || reconnectTimer || connected || connecting) return;
  const delay = Math.min(
    RECONNECT_BASE_DELAY_MS * (2 ** reconnectAttempt),
    RECONNECT_MAX_DELAY_MS,
  );
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureConnection();
  }, delay);
  reconnectTimer.unref?.();
}

function buildConnectParams(nonce: string) {
  const clientId = CONVOSKETCHPAD_GATEWAY_CLIENT_ID;
  const clientMode = CONVOSKETCHPAD_GATEWAY_CLIENT_MODE;
  const role = 'operator';
  const scopes = [...CONVOSKETCHPAD_OPERATOR_SCOPES];
  const gatewayUrl = getGatewayWsUrl();
  const connectionMode = gatewayConnectionMode(gatewayUrl);
  const storedAuth = connectionMode === 'remote' && !deviceTokenRetryUsed
    ? getStoredDeviceAuth(gatewayUrl)
    : null;
  const token = storedAuth?.token || openClawConfig.gatewayToken;
  const device = connectionMode === 'remote'
    ? createDeviceBlock({
      clientId,
      clientMode,
      role,
      scopes,
      token,
      nonce,
    })
    : undefined;

  return {
    connectionMode,
    usedStoredDeviceToken: Boolean(storedAuth),
    params: {
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: clientId,
        displayName: 'ConvoSketchpad',
        version: packageMetadata.version,
        platform: CONVOSKETCHPAD_GATEWAY_CLIENT_PLATFORM,
        mode: clientMode,
        instanceId: `convosketchpad-rpc-${randomUUID().slice(0, 8)}`,
      },
      role,
      scopes,
      auth: { token },
      ...(device ? { device } : {}),
    },
  };
}

/** Send a raw message, ensuring the connection is ready. */
function wsSend(data: string, call?: PendingCall): boolean {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(data);
      if (call) call.frameSent = true;
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Clean up all pending calls with an error. */
function rejectAllPending(reason: string): void {
  for (const [id, call] of pending) {
    clearTimeout(call.timer);
    call.reject(call.classifyDispatch
      ? new GatewayDispatchError(call.frameSent ? 'outcome_unknown' : 'not_sent', reason)
      : new Error(reason));
    pending.delete(id);
  }
}

/** Reject and clear the in-flight connect promise. */
function rejectConnect(reason: string): void {
  if (connectReject) {
    connectReject(new Error(reason));
  }
  connectPromise = null;
  connectResolve = null;
  connectReject = null;
}

/** Establish the persistent gateway connection. */
function ensureConnection(): void {
  if (shuttingDown) return;
  if (ws || connecting) return;
  const configuredGatewayUrl = getGatewayWsUrl();
  const configuredMode = gatewayConnectionMode(configuredGatewayUrl);
  if (
    !openClawConfig.gatewayToken
    && (
      configuredMode === 'loopback'
      || !getStoredDeviceAuth(configuredGatewayUrl)
    )
  ) return;

  connecting = true;
  lastConnectionError = '';
  emitStatus();
  if (!connectPromise) {
    connectPromise = new Promise<void>((resolve, reject) => {
      connectResolve = resolve;
      connectReject = reject;
    });
    // Status/event subscribers can initiate a connection without awaiting it.
    // Keep the promise observable by RPC callers without producing an unhandled
    // rejection when an initial background connection attempt fails.
    void connectPromise.catch(() => undefined);
  }
  const wsUrl = configuredGatewayUrl;
  let connectUsedStoredDeviceToken = false;
  let connectGatewayMode: GatewayConnectionMode = gatewayConnectionMode(wsUrl);
  let retryAfterClearingDeviceToken = false;

  const socket = new WebSocket(wsUrl);
  ws = socket;

  socket.on('open', () => {
    // Wait for connect.challenge
  });

  socket.on('message', (data: Buffer | string) => {
    try {
      const msg = JSON.parse(data.toString());

      // Handle connect.challenge → send connect
      if (msg.type === 'event' && msg.event === 'connect.challenge' && msg.payload?.nonce) {
        const assembled = buildConnectParams(msg.payload.nonce);
        connectUsedStoredDeviceToken = assembled.usedStoredDeviceToken;
        connectGatewayMode = assembled.connectionMode;
        socket.send(JSON.stringify({
          type: 'req',
          id: '__connect__',
          method: 'connect',
          params: assembled.params,
        }));
        return;
      }

      // Handle connect response
      if (msg.type === 'res' && msg.id === '__connect__') {
        connecting = false;
        if (msg.ok) {
          const methods = Array.isArray(msg.payload?.features?.methods)
            ? msg.payload.features.methods.filter((value: unknown): value is string => typeof value === 'string')
            : [];
          const maxPayload = typeof msg.payload?.policy?.maxPayload === 'number' && msg.payload.policy.maxPayload > 0
            ? msg.payload.policy.maxPayload
            : undefined;
          capabilities = {
            serverVersion: typeof msg.payload?.server?.version === 'string' ? msg.payload.server.version : undefined,
            methods: new Set(methods),
            maxPayload,
          };
          const auth = msg.payload?.auth as {
            deviceToken?: string;
            role?: string;
            scopes?: string[];
          } | undefined;
          if (connectGatewayMode === 'remote' && auth?.deviceToken) {
            storeDeviceAuth({
              gatewayUrl: wsUrl,
              token: auth.deviceToken,
              role: auth.role,
              scopes: auth.scopes,
            });
          }
          deviceTokenRetryUsed = false;
          reconnectAttempt = 0;
          ws = socket;
          connected = true;
          lastConnectionError = '';
          emitStatus();
          if (connectResolve) {
            connectResolve();
          }
          connectResolve = null;
          connectReject = null;
          console.log('[gateway-rpc] Connected to gateway (persistent)');
        } else {
          const detailCode = msg.error?.details?.code;
          if (
            connectUsedStoredDeviceToken
            && !deviceTokenRetryUsed
            && (
              detailCode === 'AUTH_TOKEN_MISMATCH'
              || detailCode === 'AUTH_DEVICE_TOKEN_MISMATCH'
              || detailCode === 'AUTH_SCOPE_MISMATCH'
            )
            && openClawConfig.gatewayToken
          ) {
            clearStoredDeviceAuth(wsUrl);
            deviceTokenRetryUsed = true;
            retryAfterClearingDeviceToken = true;
            connecting = false;
            socket.close(1000, 'retrying with bootstrap auth');
            return;
          }
          const reason = msg.error?.message || 'Gateway connect rejected';
          lastConnectionError = reason;
          emitStatus();
          console.error('[gateway-rpc] Gateway connect rejected:', reason);
          rejectConnect(reason);
          socket.close();
        }
        return;
      }

      // Handle RPC responses
      if (msg.type === 'res' && pending.has(msg.id)) {
        const call = pending.get(msg.id)!;
        pending.delete(msg.id);
        clearTimeout(call.timer);
        if (msg.ok === false) {
          const message = msg.error?.message || 'RPC error';
          const details = msg.error?.details && typeof msg.error.details === 'object'
            ? msg.error.details as Record<string, unknown>
            : undefined;
          call.reject(call.classifyDispatch
            ? new GatewayDispatchError('rejected', message)
            : new GatewayRpcError(message, details));
        } else {
          call.resolve(msg.payload ?? msg.result ?? msg);
        }
        return;
      }

      if (msg.type === 'event' && typeof msg.event === 'string') {
        for (const subscriber of eventSubscribers) {
          try {
            subscriber(msg as GatewayEvent);
          } catch (error) {
            eventSubscribers.delete(subscriber);
            console.warn(
              '[gateway-rpc] Removed failed event subscriber:',
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  });

  socket.on('error', (err) => {
    if (!shuttingDown) {
      lastConnectionError = err.message;
      console.warn('[gateway-rpc] WebSocket error:', err.message);
    }
  });

  socket.on('close', () => {
    if (retryAfterClearingDeviceToken && !shuttingDown) {
      ws = null;
      connected = false;
      connecting = false;
      setTimeout(() => ensureConnection(), 0);
      return;
    }
    const wasConnecting = connecting;
    ws = null;
    connected = false;
    connecting = false;
    capabilities = { methods: new Set() };
    if (!shuttingDown && !lastConnectionError) lastConnectionError = 'Gateway connection closed';
    emitStatus();

    if (wasConnecting) {
      rejectConnect('Gateway connection closed before connect completed');
    } else {
      connectPromise = null;
      connectResolve = null;
      connectReject = null;
    }

    rejectAllPending('Gateway connection closed');

    // Every unintentional close is recoverable, including startup races where
    // the Gateway was unavailable before the first handshake completed.
    scheduleReconnect();
  });
}

// ── Core RPC call ────────────────────────────────────────────────────

/**
 * Execute a gateway RPC call via the persistent WebSocket connection.
 */
export async function gatewayRpcCall(
  method: string,
  params: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  return gatewayCall(method, params, timeoutMs, false);
}

async function gatewayCall(
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  classifyDispatch: boolean,
): Promise<unknown> {
  if (shuttingDown) throw new Error('Gateway RPC client is shutting down');

  // Ensure connection exists
  ensureConnection();

  // Wait for connection if not yet connected
  if (!connected && connectPromise) {
    try {
      await connectPromise;
    } catch (error) {
      if (classifyDispatch) {
        throw new GatewayDispatchError('not_sent', error instanceof Error ? error.message : 'Gateway connection failed');
      }
      throw error;
    }
  }

  return new Promise((resolve, reject) => {
    const reqId = randomUUID();
    const frame = JSON.stringify({ type: 'req', id: reqId, method, params });
    const frameBytes = Buffer.byteLength(frame);
    if (capabilities.maxPayload && frameBytes > capabilities.maxPayload) {
      const message = `Gateway request is ${frameBytes} bytes, exceeding the advertised ${capabilities.maxPayload}-byte payload limit`;
      reject(classifyDispatch ? new GatewayDispatchError('rejected', message) : new Error(message));
      return;
    }

    const call: PendingCall = {
      resolve,
      reject,
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
      method,
      frameSent: false,
      classifyDispatch,
    };
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(classifyDispatch
        ? new GatewayDispatchError(call.frameSent ? 'outcome_unknown' : 'not_sent', `Gateway RPC timeout after ${timeoutMs}ms calling ${method}`)
        : new Error(`Gateway RPC timeout after ${timeoutMs}ms calling ${method}`));
    }, timeoutMs);
    call.timer = timer;

    pending.set(reqId, call);

    const sent = wsSend(frame, call);
    if (!sent) {
      pending.delete(reqId);
      clearTimeout(timer);
      reject(classifyDispatch
        ? new GatewayDispatchError('not_sent', 'Gateway connection not ready')
        : new Error('Gateway connection not ready'));
    }
  });
}

export function gatewayDispatchCall(
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<unknown> {
  return gatewayCall(method, params, timeoutMs, true);
}

export function getGatewayRuntimeStatus(): GatewayRuntimeStatus {
  return runtimeStatus();
}

export function subscribeGatewayEvents(subscriber: (event: GatewayEvent) => void): () => void {
  eventSubscribers.add(subscriber);
  ensureConnection();
  return () => eventSubscribers.delete(subscriber);
}

export function subscribeGatewayStatus(subscriber: (status: GatewayRuntimeStatus) => void): () => void {
  statusSubscribers.add(subscriber);
  subscriber(runtimeStatus());
  ensureConnection();
  return () => statusSubscribers.delete(subscriber);
}

export function gatewaySupports(method: string): boolean {
  return capabilities.methods.has(method);
}

/** Shared-secret credential for Gateway HTTP routes; paired device tokens are WS-only. */
export function getGatewaySharedHttpAuthToken(): string {
  return openClawConfig.gatewayToken;
}

/** Stop reconnects, reject pending work, and release the persistent socket. */
export function closeGatewayRpc(): void {
  shuttingDown = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;

  rejectConnect('Gateway RPC client is shutting down');
  rejectAllPending('Gateway RPC client is shutting down');
  connected = false;
  connecting = false;
  capabilities = { methods: new Set() };
  emitStatus();

  const socket = ws;
  ws = null;
  if (
    socket
    && (
      socket.readyState === WebSocket.CONNECTING
      || socket.readyState === WebSocket.OPEN
      || socket.readyState === WebSocket.CLOSING
    )
  ) {
    socket.terminate();
  }
}
