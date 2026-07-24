/**
 * Device identity for OpenClaw gateway WebSocket authentication.
 *
 * OpenClaw 2026.2.19+ requires device identity (Ed25519 keypair + signed challenge)
 * for WS connections to receive `operator.read` / `operator.write` scopes.
 *
 * The keypair is generated once and persisted to `~/.convosketchpad/device-identity.json`.
 * On subsequent starts the same identity is reused, avoiding re-pairing.
 * @module
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CONVOSKETCHPAD_OPERATOR_SCOPES = ['operator.read', 'operator.write'] as const;

interface DeviceIdentity {
  deviceId: string;
  publicKeyRaw: Buffer;      // 32-byte raw Ed25519 public key
  publicKeyB64url: string;    // base64url-encoded raw public key
  privateKeyPem: string;      // PEM-encoded private key for signing
}

let cached: DeviceIdentity | null = null;

function dataDir(): string {
  const dir = process.env.CONVOSKETCHPAD_DATA_DIR
    || path.join(process.env.HOME || process.cwd(), '.convosketchpad');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Path to the identity file (next to the running process) */
function identityPath(): string {
  const dir = dataDir();
  return path.join(dir, 'device-identity.json');
}

function gatewayAuthPath(): string {
  return path.join(dataDir(), 'gateway-auth.json');
}

export function normalizeGatewayAuthKey(gatewayUrl: string | URL): string {
  const parsed = gatewayUrl instanceof URL ? new URL(gatewayUrl) : new URL(gatewayUrl);
  if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
  if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
  if (!parsed.pathname || parsed.pathname === '/') parsed.pathname = '/ws';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

interface StoredGatewayAuth {
  deviceId: string;
  role: 'operator';
  scopes: string[];
  token: string;
  updatedAt: string;
}

interface GatewayAuthStore {
  version: 1;
  gateways: Record<string, StoredGatewayAuth>;
}

function hasExactOperatorScopes(scopes: string[]): boolean {
  return scopes.length === CONVOSKETCHPAD_OPERATOR_SCOPES.length
    && CONVOSKETCHPAD_OPERATOR_SCOPES.every(scope => scopes.includes(scope));
}

function readGatewayAuthStore(): GatewayAuthStore {
  const authPath = gatewayAuthPath();
  if (!fs.existsSync(authPath)) return { version: 1, gateways: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(authPath, 'utf8')) as GatewayAuthStore;
    if (parsed.version !== 1 || !parsed.gateways || typeof parsed.gateways !== 'object') {
      return { version: 1, gateways: {} };
    }
    return parsed;
  } catch {
    return { version: 1, gateways: {} };
  }
}

function writeGatewayAuthStore(store: GatewayAuthStore): void {
  const authPath = gatewayAuthPath();
  const tempPath = `${authPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, authPath);
  fs.chmodSync(authPath, 0o600);
}

export function getStoredDeviceAuth(gatewayUrl: string | URL): StoredGatewayAuth | null {
  const identity = getDeviceIdentity();
  const stored = readGatewayAuthStore().gateways[normalizeGatewayAuthKey(gatewayUrl)];
  if (!stored || stored.deviceId !== identity.deviceId || !stored.token) return null;
  if (!hasExactOperatorScopes(stored.scopes)) return null;
  return stored;
}

export function storeDeviceAuth(input: {
  gatewayUrl: string | URL;
  token: string;
  role?: string;
  scopes?: string[];
}): void {
  const token = input.token.trim();
  if (!token) return;
  const role = input.role || 'operator';
  if (role !== 'operator') return;
  const scopes = [...new Set(input.scopes || [])];
  if (!hasExactOperatorScopes(scopes)) return;

  const store = readGatewayAuthStore();
  const identity = getDeviceIdentity();
  store.gateways[normalizeGatewayAuthKey(input.gatewayUrl)] = {
    deviceId: identity.deviceId,
    role: 'operator',
    scopes,
    token,
    updatedAt: new Date().toISOString(),
  };
  writeGatewayAuthStore(store);
}

export function clearStoredDeviceAuth(gatewayUrl: string | URL): void {
  const store = readGatewayAuthStore();
  const key = normalizeGatewayAuthKey(gatewayUrl);
  if (!store.gateways[key]) return;
  delete store.gateways[key];
  writeGatewayAuthStore(store);
}

/** Load or generate a persistent Ed25519 device identity */
export function getDeviceIdentity(): DeviceIdentity {
  if (cached) return cached;

  const idPath = identityPath();

  // Try loading existing identity
  if (fs.existsSync(idPath)) {
    try {
      const stored = JSON.parse(fs.readFileSync(idPath, 'utf-8'));
      if (stored.publicKeyB64url && stored.privateKeyPem && stored.deviceId) {
        cached = {
          deviceId: stored.deviceId,
          publicKeyRaw: Buffer.from(stored.publicKeyB64url, 'base64url'),
          publicKeyB64url: stored.publicKeyB64url,
          privateKeyPem: stored.privateKeyPem,
        };
        console.log(`[device-identity] Loaded existing identity: ${cached.deviceId.substring(0, 12)}…`);
        return cached;
      }
    } catch (err) {
      console.warn('[device-identity] Failed to load identity, regenerating:', (err as Error).message);
    }
  }

  // Generate new Ed25519 keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const rawPub = pubDer.slice(-32); // Ed25519 SPKI has 12-byte header
  const pubB64url = rawPub.toString('base64url');
  const deviceId = crypto.createHash('sha256').update(rawPub).digest('hex');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  cached = {
    deviceId,
    publicKeyRaw: rawPub,
    publicKeyB64url: pubB64url,
    privateKeyPem,
  };

  // Persist identity
  const stored = {
    deviceId,
    publicKeyB64url: pubB64url,
    privateKeyPem,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(idPath, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
  console.log(`[device-identity] Generated new identity: ${deviceId.substring(0, 12)}… → ${idPath}`);

  return cached;
}

/**
 * Build the signing payload for a connect request (v2 protocol).
 *
 * Format: v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce
 */
export function buildSigningPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string;
  nonce: string;
}): string {
  return [
    'v2',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(','),
    String(params.signedAtMs),
    params.token,
    params.nonce,
  ].join('|');
}

/** Sign a payload with the device's Ed25519 private key, return base64url */
export function signPayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  return crypto.sign(null, Buffer.from(payload, 'utf8'), key).toString('base64url');
}

/**
 * Create the `device` object to inject into a connect request.
 *
 * Call this after receiving the connect.challenge nonce and the client's
 * connect params (to extract clientId, clientMode, role, scopes, token).
 */
export function createDeviceBlock(params: {
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  token: string;
  nonce: string;
}): {
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
} {
  const identity = getDeviceIdentity();
  const signedAt = Date.now();

  const payload = buildSigningPayload({
    deviceId: identity.deviceId,
    clientId: params.clientId,
    clientMode: params.clientMode,
    role: params.role,
    scopes: params.scopes,
    signedAtMs: signedAt,
    token: params.token,
    nonce: params.nonce,
  });

  const signature = signPayload(identity.privateKeyPem, payload);

  return {
    id: identity.deviceId,
    publicKey: identity.publicKeyB64url,
    signature,
    signedAt,
    nonce: params.nonce,
  };
}
