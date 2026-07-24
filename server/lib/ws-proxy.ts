/**
 * WebSocket proxy — bridges browser clients to the OpenClaw gateway.
 *
 * Clients connect to `ws(s)://host:port/ws?target=<gateway-ws-url>` and this
 * module opens a corresponding connection to the gateway, relaying messages
 * bidirectionally. During the connect handshake, injects ConvoSketchpad's Ed25519-signed
 * device identity so the gateway grants operator.read/write scopes.
 *
 * On the first ever connection the gateway creates a pending pairing request.
 * The user must approve it once via `openclaw devices approve <requestId>`.
 * Device tokens returned by OpenClaw are stored server-side and removed from
 * responses before they are relayed to the browser.
 * @module
 */

import type { Server as HttpsServer } from 'node:https';
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { config, WS_ALLOWED_HOSTS, SESSION_COOKIE_NAME } from './config.js';
import { verifySession, parseSessionCookie } from './session.js';
import {
  clearStoredDeviceAuth,
  CONVOSKETCHPAD_OPERATOR_SCOPES,
  createDeviceBlock,
  getDeviceIdentity,
  getStoredDeviceAuth,
  storeDeviceAuth,
} from './device-identity.js';
import { gatewayRpcCall } from './gateway-rpc.js';
import { canInjectGatewayToken } from './trust-utils.js';
import { isAllowedOrigin } from './origin-utils.js';
import { isManagedIdentityActive, resolveManagedSession, type ManagedIdentity } from './managed-users.js';

/** @internal — exported for test overrides */
export const _internals = { challengeTimeoutMs: 5_000 };

/**
 * Methods the gateway restricts for webchat clients.
 * We intercept these and proxy via `openclaw gateway call` (full CLI scopes).
 */
const RESTRICTED_METHODS = new Set([
  'sessions.patch',
  'sessions.delete',
  'sessions.reset',
  'sessions.compact',
]);
const CONTROL_UI_CLIENT_ID = 'openclaw-control-ui';

/**
 * Execute a gateway RPC call, bypassing webchat restrictions.
 * Delegates to the shared gateway-rpc module.
 */
function gatewayCall(method: string, params: Record<string, unknown>): Promise<unknown> {
  return gatewayRpcCall(method, params);
}

/** Active WSS instances — used for graceful shutdown */
const activeWssInstances: WebSocketServer[] = [];

/** Close all active WebSocket connections */
export function closeAllWebSockets(): void {
  for (const wss of activeWssInstances) {
    for (const client of wss.clients) client.close(1001, 'Server shutting down');
    wss.close();
  }
  activeWssInstances.length = 0;
}

/**
 * Set up the WS/WSS proxy on an HTTP or HTTPS server.
 * Proxies ws(s)://host:port/ws?target=ws://gateway/ws to the OpenClaw gateway.
 */
export function setupWebSocketProxy(server: HttpServer | HttpsServer): void {
  const wss = new WebSocketServer({ noServer: true });
  activeWssInstances.push(wss);

  // Eagerly load device identity at startup
  getDeviceIdentity();

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.startsWith('/ws')) {
      const originHeader = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
      if (!isAllowedOrigin(originHeader)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nOrigin not allowed');
        socket.destroy();
        return;
      }

      // Auth check for WebSocket connections
      let managedIdentity: ManagedIdentity | null = null;
      if (config.auth) {
        const token = parseSessionCookie(req.headers.cookie, SESSION_COOKIE_NAME);
        managedIdentity = token ? resolveManagedSession(verifySession(token, config.sessionSecret)) : null;
        if (!managedIdentity) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nAuthentication required');
          socket.destroy();
          return;
        }
      }
      (req as IncomingMessage & { convosketchpadIdentity?: ManagedIdentity }).convosketchpadIdentity = managedIdentity || undefined;
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (clientWs: WebSocket, req: IncomingMessage) => {
    const connId = randomUUID().slice(0, 8);
    const tag = `[ws-proxy:${connId}]`;
    const url = new URL(req.url || '/', 'https://localhost');
    const target = url.searchParams.get('target');

    console.log(`${tag} New connection: target=${target}`);

    if (!target) {
      clientWs.close(1008, 'Missing ?target= param');
      return;
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(target);
    } catch {
      clientWs.close(1008, 'Invalid target URL');
      return;
    }

    if (!['ws:', 'wss:'].includes(targetUrl.protocol) || !WS_ALLOWED_HOSTS.has(targetUrl.hostname)) {
      console.warn(`${tag} Rejected: target not allowed: ${target}`);
      clientWs.close(1008, 'Target not allowed');
      return;
    }

    const targetPort = Number(targetUrl.port) || (targetUrl.protocol === 'wss:' ? 443 : 80);
    if (targetPort < 1 || targetPort > 65535) {
      console.warn(`${tag} Rejected: invalid port ${targetPort}`);
      clientWs.close(1008, 'Invalid target port');
      return;
    }

    const isEncrypted = !!(req.socket as unknown as { encrypted?: boolean }).encrypted;
    const scheme = isEncrypted ? 'https' : 'http';
    const clientOrigin = (Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin)
      || `${scheme}://${req.headers.host}`;

    // Determine if the client is trusted enough for token injection.
    // canInjectGatewayToken accounts for both auth state and loopback detection (proxy-aware).
    const isTrusted = canInjectGatewayToken(req);

    const managedIdentity = (req as IncomingMessage & { convosketchpadIdentity?: ManagedIdentity }).convosketchpadIdentity;
    createGatewayRelay(clientWs, targetUrl, clientOrigin, connId, isTrusted, managedIdentity);
  });
}

/**
 * Create a relay between a browser WebSocket and the gateway.
 *
 * Injects ConvoSketchpad's device identity into the connect handshake for full
 * operator scopes. The connect message is held until the gateway sends a
 * `connect.challenge` nonce so that device identity can always be injected.
 * If the nonce doesn't arrive within `_internals.challengeTimeoutMs`, the
 * connection is refused instead of falling back to unsigned authentication.
 */
function createGatewayRelay(
  clientWs: WebSocket,
  targetUrl: URL,
  clientOrigin: string,
  connId: string,
  isTrusted: boolean,
  managedIdentity?: ManagedIdentity,
): void {
  const tag = `[ws-proxy:${connId}]`;
  const connStartTime = Date.now();
  let clientToGatewayCount = 0;
  let gatewayToClientCount = 0;

  // ─── Keepalive: ping both sides every 30s, kill dead connections ────────
  const PING_INTERVAL = 30_000;
  let clientAlive = true;
  let gatewayAlive = true;

  clientWs.on('pong', () => { clientAlive = true; });

  const pingTimer = setInterval(() => {
    if (managedIdentity && !isManagedIdentityActive(managedIdentity)) {
      console.log(`${tag} Managed session revoked — closing`);
      clientWs.close(1008, 'Authentication expired');
      return;
    }
    // Check client
    if (!clientAlive) {
      console.log(`${tag} Client pong timeout — terminating`);
      clientWs.terminate();
      return;
    }
    clientAlive = false;
    if (clientWs.readyState === WebSocket.OPEN) clientWs.ping();

    // Check gateway
    if (gwWs && !gatewayAlive) {
      console.log(`${tag} Gateway pong timeout — terminating`);
      gwWs.terminate();
      return;
    }
    gatewayAlive = false;
    if (gwWs?.readyState === WebSocket.OPEN) gwWs.ping();
  }, PING_INTERVAL);

  let gwWs: WebSocket;
  let challengeNonce: string | null = null;
  let handshakeComplete = false;
  let hasRetried = false;
  let forceBootstrapAuth = false;
  let connectUsedStoredDeviceToken = false;
  let retryAfterAuthFailure = false;
  /** Saved connect message — held separately from pending until challenge arrives */
  let savedConnectMsg: Record<string, unknown> | null = null;
  /** Whether the saved connect message has been dispatched to the gateway */
  let connectSent = false;
  /** Whether this connection is using the privileged OpenClaw control UI client id */
  let isControlUiClient = false;
  /** Timeout handle for challenge nonce deadline */
  let challengeTimer: ReturnType<typeof setTimeout> | null = null;

  // Buffer client messages until gateway connection is open (with cap)
  const MAX_PENDING = 100;
  const MAX_BYTES = 1024 * 1024; // 1 MB
  let pending: { data: Buffer | string; isBinary: boolean }[] = [];
  let pendingBytes = 0;

  /** Queue a client message for deferred forwarding. Returns false if limits exceeded. */
  function enqueuePending(data: Buffer | string, isBinary: boolean): boolean {
    const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
    if (pending.length >= MAX_PENDING || pendingBytes + size > MAX_BYTES) {
      return false;
    }
    pendingBytes += size;
    pending.push({ data, isBinary });
    return true;
  }

  /** Flush buffered messages to gateway in FIFO order. */
  function flushPending(): void {
    if (!gwWs || gwWs.readyState !== WebSocket.OPEN) return;
    for (const msg of pending) {
      gwWs.send(msg.isBinary ? msg.data : msg.data.toString());
    }
    pending = [];
    pendingBytes = 0;
  }

  /** Clear the challenge nonce timeout if active. */
  function clearChallengeTimer(): void {
    if (challengeTimer) {
      clearTimeout(challengeTimer);
      challengeTimer = null;
    }
  }

  function updateClientKindFromConnect(msg: Record<string, unknown>): void {
    const params = (msg.params || {}) as ConnectParams;
    isControlUiClient = params.client?.id === CONTROL_UI_CLIENT_ID;
  }

  /**
   * Dispatch the saved connect message to the gateway.
   * Injects device identity using the required Gateway challenge nonce.
   */
  function dispatchConnect(nonce: string): void {
    if (!savedConnectMsg || connectSent) return;
    if (gwWs.readyState !== WebSocket.OPEN) return;
    connectSent = true;
    clearChallengeTimer();

    let modified = savedConnectMsg;
    const incomingAuth = (modified.params as ConnectParams)?.auth || {};
    const storedAuth = forceBootstrapAuth ? null : getStoredDeviceAuth(targetUrl);
    const bootstrapToken = incomingAuth.token || (isTrusted ? config.gatewayToken : '');
    const selectedToken = storedAuth?.token || bootstrapToken;
    connectUsedStoredDeviceToken = Boolean(storedAuth);
    if (selectedToken) {
      modified = {
        ...modified,
        params: {
          ...(modified.params as object),
          auth: {
            ...incomingAuth,
            token: selectedToken,
          },
        },
      };
    }

    const final = injectDeviceIdentity(modified, nonce);

    gwWs.send(JSON.stringify(final));
    handshakeComplete = true;
    flushPending();
  }

  /** Start a deadline timer — refuse the connection if no signed challenge is possible. */
  function startChallengeDeadline(): void {
    clearChallengeTimer();
    challengeTimer = setTimeout(() => {
      console.warn('[ws-proxy] Challenge nonce timeout — refusing an unsigned Gateway connection');
      clientWs.close(1008, 'Gateway device challenge timed out');
      gwWs.close(1008, 'device challenge timed out');
    }, _internals.challengeTimeoutMs);
  }

  function openGateway(): void {
    gatewayAlive = true;
    challengeNonce = null;
    handshakeComplete = false;
    connectSent = false;
    clearChallengeTimer();

    gwWs = new WebSocket(targetUrl.toString(), {
      headers: { Origin: clientOrigin },
    });

    gwWs.on('pong', () => { gatewayAlive = true; });

    // Gateway → Client
    gwWs.on('message', (data: Buffer | string, isBinary: boolean) => {
      // Capture challenge nonce before handshake completes
      if (!handshakeComplete && !isBinary) {
        try {
          const msg = JSON.parse(data.toString());
          const nonce = msg.payload?.nonce;
          if (msg.type === 'event' && msg.event === 'connect.challenge' && typeof nonce === 'string') {
            challengeNonce = nonce;
            // If we have a deferred connect message waiting, send it now with identity
            if (savedConnectMsg && !connectSent && gwWs.readyState === WebSocket.OPEN) {
              dispatchConnect(nonce);
            }
          }
        } catch { /* ignore */ }
      }

      let forwarded = data.toString();
      if (!isBinary) {
        try {
          const msg = JSON.parse(forwarded);
          const connectId = savedConnectMsg?.id;
          if (msg.type === 'res' && connectId && msg.id === connectId) {
            const auth = msg.payload?.auth as {
              deviceToken?: string;
              deviceTokens?: unknown;
              role?: string;
              scopes?: string[];
            } | undefined;
            if (msg.ok && auth) {
              if (auth.deviceToken) {
                storeDeviceAuth({
                  gatewayUrl: targetUrl,
                  token: auth.deviceToken,
                  role: auth.role,
                  scopes: auth.scopes,
                });
              }
              const safeAuth = { ...auth };
              delete safeAuth.deviceToken;
              delete safeAuth.deviceTokens;
              forwarded = JSON.stringify({
                ...msg,
                payload: { ...msg.payload, auth: safeAuth },
              });
              forceBootstrapAuth = false;
              hasRetried = false;
            } else if (
              !msg.ok
              && connectUsedStoredDeviceToken
              && !hasRetried
              && (msg.error?.details?.code === 'AUTH_TOKEN_MISMATCH'
                || msg.error?.details?.code === 'AUTH_DEVICE_TOKEN_MISMATCH'
                || msg.error?.details?.code === 'AUTH_SCOPE_MISMATCH')
              && (incomingBootstrapToken(savedConnectMsg) || (isTrusted && config.gatewayToken))
            ) {
              clearStoredDeviceAuth(targetUrl);
              forceBootstrapAuth = true;
              hasRetried = true;
              retryAfterAuthFailure = true;
              gwWs.close(1000, 'retrying with bootstrap auth');
              return;
            }
          }
        } catch {
          // Forward non-JSON and unrecognized Gateway messages unchanged.
        }
      }

      if (clientWs.readyState === WebSocket.OPEN) {
        gatewayToClientCount++;
        clientWs.send(isBinary ? data : forwarded);
      }
    });

    gwWs.on('open', () => {
      // Handle deferred connect message first. Non-connect pending messages are
      // flushed only after connect is dispatched to preserve protocol ordering.
      if (savedConnectMsg && !connectSent) {
        if (challengeNonce) {
          // Challenge already arrived — send with identity
          dispatchConnect(challengeNonce);
        } else {
          // Wait for a challenge nonce; unsigned connections are never attempted.
          startChallengeDeadline();
        }
      } else {
        // No deferred connect waiting — safe to flush pending traffic immediately.
        flushPending();
      }
    });

    gwWs.on('error', (err) => {
      console.error(`${tag} Gateway error:`, err.message);
      clearChallengeTimer();
      if (!hasRetried || handshakeComplete) clientWs.close();
    });

    gwWs.on('close', (code, reason) => {
      const reasonStr = reason?.toString() || '';
      console.log(`${tag} Gateway closed: code=${code}, reason=${reasonStr}`);
      clearChallengeTimer();

      if (retryAfterAuthFailure && clientWs.readyState === WebSocket.OPEN) {
        retryAfterAuthFailure = false;
        openGateway();
        return;
      }

      clientWs.close();
    });
  }

  // Client → Gateway (attached once, references mutable gwWs)
  clientWs.on('message', (data: Buffer | string, isBinary: boolean) => {
    if (managedIdentity && !isManagedIdentityActive(managedIdentity)) {
      clientWs.close(1008, 'Authentication expired');
      return;
    }
    if (!gwWs || gwWs.readyState !== WebSocket.OPEN) {
      // Gateway not open — intercept connect messages and hold them separately
      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'req' && msg.method === 'connect' && msg.params) {
            savedConnectMsg = msg;
            updateClientKindFromConnect(msg);
            return; // Do NOT add to pending buffer
          }
        } catch { /* pass through */ }
      }

      if (!enqueuePending(data, isBinary)) {
        clientWs.close(1008, 'Too many pending messages');
        return;
      }
      return;
    }

    // Gateway is open, but if connect is still deferred, queue non-connect
    // traffic until connect is dispatched.
    if (!handshakeComplete && savedConnectMsg && !connectSent) {
      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'req' && msg.method === 'connect' && msg.params) {
            // Last-write-wins if multiple connect frames arrive before dispatch.
            savedConnectMsg = msg;
            updateClientKindFromConnect(msg);
            if (challengeNonce) {
              dispatchConnect(challengeNonce);
            } else {
              startChallengeDeadline();
            }
            return;
          }
        } catch { /* pass through to pending queue */ }
      }

      if (!enqueuePending(data, isBinary)) {
        clientWs.close(1008, 'Too many pending messages');
      }
      return;
    }

    // Gateway is open — parse message for interception
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString());

        // Intercept connect request — defer until challenge nonce arrives
        if (!handshakeComplete && msg.type === 'req' && msg.method === 'connect' && msg.params) {
          savedConnectMsg = msg;
          updateClientKindFromConnect(msg);
          if (challengeNonce) {
            dispatchConnect(challengeNonce);
          } else {
            startChallengeDeadline();
          }
          return;
        }

        // Intercept restricted RPC methods for plain webchat clients only.
        // Control UI clients are allowed to call these directly on the gateway.
        if (msg.type === 'req' && RESTRICTED_METHODS.has(msg.method) && !isControlUiClient) {
          const reqId = msg.id;
          gatewayCall(msg.method, msg.params || {})
            .then((result) => {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: 'res', id: reqId, ok: true, payload: result }));
              }
            })
            .catch((err) => {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                  type: 'res',
                  id: reqId,
                  ok: false,
                  error: { code: -32000, message: (err as Error).message },
                }));
              }
            });
          return;
        }
      } catch { /* pass through */ }
    }

    clientToGatewayCount++;
    gwWs.send(isBinary ? data : data.toString());
  });

  clientWs.on('close', (code, reason) => {
    clearInterval(pingTimer);
    clearChallengeTimer();
    const duration = Date.now() - connStartTime;
    console.log(`${tag} Client closed: code=${code}, reason=${reason?.toString()}`);
    console.log(`${tag} Summary: duration=${duration}ms, client->gw=${clientToGatewayCount}, gw->client=${gatewayToClientCount}`);
    if (gwWs) gwWs.close();
  });
  clientWs.on('error', (err) => {
    clearInterval(pingTimer);
    clearChallengeTimer();
    console.error(`${tag} Client error:`, err.message);
    if (gwWs) gwWs.close();
  });

  openGateway();
}

/**
 * Inject ConvoSketchpad's device identity into a connect request.
 */
interface ConnectParams {
  client?: { id?: string; mode?: string; instanceId?: string; [key: string]: unknown };
  role?: string;
  scopes?: string[];
  auth?: { token?: string };
}

function injectDeviceIdentity(msg: Record<string, unknown>, nonce: string, logTag = '[ws-proxy]'): Record<string, unknown> {
  const params = (msg.params || {}) as ConnectParams;
  const clientId = params.client?.id || 'convosketchpad-ui';
  const clientMode = params.client?.mode || 'webchat';
  const role = 'operator';
  const finalScopes = [...CONVOSKETCHPAD_OPERATOR_SCOPES];
  const token = params.auth?.token || '';

  const device = createDeviceBlock({
    clientId,
    clientMode,
    role,
    scopes: finalScopes,
    token,
    nonce,
  });

  console.log(`${logTag} Injected device identity: ${device.id.substring(0, 12)}...`);

  return {
    ...msg,
    params: {
      ...params,
      role,
      scopes: finalScopes,
      device,
    },
  };
}

function incomingBootstrapToken(msg: Record<string, unknown> | null): string {
  if (!msg) return '';
  const params = (msg.params || {}) as ConnectParams;
  return params.auth?.token || '';
}
