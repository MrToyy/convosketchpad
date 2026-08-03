/** Tests for device-identity — Ed25519 keypair, signing, and persistence. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let getDeviceIdentity: typeof import('./device-identity.js').getDeviceIdentity;
let buildSigningPayload: typeof import('./device-identity.js').buildSigningPayload;
let signPayload: typeof import('./device-identity.js').signPayload;
let createDeviceBlock: typeof import('./device-identity.js').createDeviceBlock;
let getStoredDeviceAuth: typeof import('./device-identity.js').getStoredDeviceAuth;
let storeDeviceAuth: typeof import('./device-identity.js').storeDeviceAuth;
let clearStoredDeviceAuth: typeof import('./device-identity.js').clearStoredDeviceAuth;
let normalizeGatewayAuthKey: typeof import('./device-identity.js').normalizeGatewayAuthKey;

describe('device-identity', () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convosketchpad-test-identity-'));
    process.env.CONVOSKETCHPAD_DATA_DIR = tmpDir;

    vi.resetModules();
    const mod = await import('./device-identity.js');
    getDeviceIdentity = mod.getDeviceIdentity;
    buildSigningPayload = mod.buildSigningPayload;
    signPayload = mod.signPayload;
    createDeviceBlock = mod.createDeviceBlock;
    getStoredDeviceAuth = mod.getStoredDeviceAuth;
    storeDeviceAuth = mod.storeDeviceAuth;
    clearStoredDeviceAuth = mod.clearStoredDeviceAuth;
    normalizeGatewayAuthKey = mod.normalizeGatewayAuthKey;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('getDeviceIdentity', () => {
    it('generates a new identity when no file exists', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const identity = getDeviceIdentity();

      expect(identity).toBeDefined();
      expect(identity.deviceId).toBeTruthy();
      expect(typeof identity.deviceId).toBe('string');
      expect(identity.deviceId).toHaveLength(64);
      expect(identity.publicKeyB64url).toBeTruthy();
      expect(identity.publicKeyRaw).toBeInstanceOf(Buffer);
      expect(identity.publicKeyRaw.length).toBe(32);
      expect(identity.privateKeyPem).toContain('PRIVATE KEY');

      logSpy.mockRestore();
    });

    it('persists identity to file', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const identity = getDeviceIdentity();
      const idPath = path.join(tmpDir, 'device-identity.json');

      expect(fs.existsSync(idPath)).toBe(true);
      const stored = JSON.parse(fs.readFileSync(idPath, 'utf-8'));
      expect(stored.deviceId).toBe(identity.deviceId);
      expect(stored.publicKeyB64url).toBe(identity.publicKeyB64url);
      expect(stored.privateKeyPem).toBe(identity.privateKeyPem);
      expect(stored.createdAt).toBeTruthy();

      logSpy.mockRestore();
    });

    it('returns the same identity on subsequent calls (caching)', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const first = getDeviceIdentity();
      const second = getDeviceIdentity();

      expect(first.deviceId).toBe(second.deviceId);
      expect(first.publicKeyB64url).toBe(second.publicKeyB64url);

      logSpy.mockRestore();
    });

    it('loads existing identity from file after module reset', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const first = getDeviceIdentity();
      logSpy.mockRestore();

      vi.resetModules();
      process.env.CONVOSKETCHPAD_DATA_DIR = tmpDir;
      const freshMod = await import('./device-identity.js');

      const logSpy2 = vi.spyOn(console, 'log').mockImplementation(() => {});
      const loaded = freshMod.getDeviceIdentity();

      expect(loaded.deviceId).toBe(first.deviceId);
      expect(loaded.publicKeyB64url).toBe(first.publicKeyB64url);

      logSpy2.mockRestore();
    });

    it('regenerates identity when file is corrupted', async () => {
      const idPath = path.join(tmpDir, 'device-identity.json');
      fs.writeFileSync(idPath, '{{invalid json', 'utf-8');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const identity = getDeviceIdentity();

      expect(identity.deviceId).toBeTruthy();
      expect(identity.deviceId).toHaveLength(64);

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('regenerates identity when file is missing required fields', async () => {
      const idPath = path.join(tmpDir, 'device-identity.json');
      fs.writeFileSync(idPath, JSON.stringify({ deviceId: 'partial' }), 'utf-8');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const identity = getDeviceIdentity();

      expect(identity.deviceId).toHaveLength(64);
      expect(identity.publicKeyB64url).toBeTruthy();
      expect(identity.privateKeyPem).toContain('PRIVATE KEY');

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('deviceId is SHA-256 of the raw public key', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const identity = getDeviceIdentity();
      const expectedId = crypto.createHash('sha256').update(identity.publicKeyRaw).digest('hex');
      expect(identity.deviceId).toBe(expectedId);
      logSpy.mockRestore();
    });
  });

  describe('buildSigningPayload', () => {
    it('produces the correct v2 format', () => {
      const payload = buildSigningPayload({
        deviceId: 'abc123',
        clientId: 'convosketchpad-ui',
        clientMode: 'webchat',
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        signedAtMs: 1700000000000,
        token: 'my-token',
        nonce: 'test-nonce',
      });

      expect(payload).toBe(
        'v2|abc123|convosketchpad-ui|webchat|operator|operator.read,operator.write|1700000000000|my-token|test-nonce',
      );
    });

    it('handles empty scopes', () => {
      const payload = buildSigningPayload({
        deviceId: 'id',
        clientId: 'client',
        clientMode: 'mode',
        role: 'role',
        scopes: [],
        signedAtMs: 0,
        token: '',
        nonce: '',
      });

      expect(payload).toBe('v2|id|client|mode|role||0||');
    });

    it('handles single scope', () => {
      const payload = buildSigningPayload({
        deviceId: 'id',
        clientId: 'client',
        clientMode: 'mode',
        role: 'role',
        scopes: ['admin'],
        signedAtMs: 1,
        token: 'tok',
        nonce: 'n',
      });

      expect(payload).toBe('v2|id|client|mode|role|admin|1|tok|n');
    });

    it('always starts with v2', () => {
      const payload = buildSigningPayload({
        deviceId: '',
        clientId: '',
        clientMode: '',
        role: '',
        scopes: [],
        signedAtMs: 0,
        token: '',
        nonce: '',
      });
      expect(payload.startsWith('v2|')).toBe(true);
    });

    it('uses pipe delimiter consistently', () => {
      const payload = buildSigningPayload({
        deviceId: 'd',
        clientId: 'c',
        clientMode: 'm',
        role: 'r',
        scopes: ['s1', 's2'],
        signedAtMs: 99,
        token: 't',
        nonce: 'n',
      });
      // Format: v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce
      // That's 9 parts = 8 pipes
      expect(payload.split('|').length).toBe(9);
    });
  });

  describe('signPayload', () => {
    it('produces a valid Ed25519 signature', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const identity = getDeviceIdentity();
      logSpy.mockRestore();

      const payload = 'test-payload-data';
      const sig = signPayload(identity.privateKeyPem, payload);

      expect(typeof sig).toBe('string');
      expect(sig.length).toBeGreaterThan(0);
      expect(sig).not.toMatch(/[+/=]/);
    });

    it('signature can be verified with the public key', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const identity = getDeviceIdentity();
      logSpy.mockRestore();

      const payload = 'verify-me';
      const sig = signPayload(identity.privateKeyPem, payload);
      const sigBuf = Buffer.from(sig, 'base64url');

      const pubKeyDer = Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        identity.publicKeyRaw,
      ]);
      const pubKey = crypto.createPublicKey({ key: pubKeyDer, format: 'der', type: 'spki' });

      const valid = crypto.verify(null, Buffer.from(payload, 'utf8'), pubKey, sigBuf);
      expect(valid).toBe(true);
    });

    it('different payloads produce different signatures', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const identity = getDeviceIdentity();
      logSpy.mockRestore();

      const sig1 = signPayload(identity.privateKeyPem, 'payload-1');
      const sig2 = signPayload(identity.privateKeyPem, 'payload-2');
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('createDeviceBlock', () => {
    it('returns a properly shaped device object', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const block = createDeviceBlock({
        clientId: 'convosketchpad-ui',
        clientMode: 'webchat',
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        token: 'test-token',
        nonce: 'test-nonce-456',
      });
      logSpy.mockRestore();

      expect(block.id).toBeTruthy();
      expect(block.id).toHaveLength(64);
      expect(block.publicKey).toBeTruthy();
      expect(typeof block.signature).toBe('string');
      expect(block.signature.length).toBeGreaterThan(0);
      expect(typeof block.signedAt).toBe('number');
      expect(block.signedAt).toBeGreaterThan(0);
      expect(block.nonce).toBe('test-nonce-456');
    });

    it('signature verifies against the expected payload', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const identity = getDeviceIdentity();

      const params = {
        clientId: 'convosketchpad-ui',
        clientMode: 'webchat',
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        token: 'my-token',
        nonce: 'challenge-nonce',
      };

      const block = createDeviceBlock(params);

      const expectedPayload = buildSigningPayload({
        deviceId: identity.deviceId,
        clientId: params.clientId,
        clientMode: params.clientMode,
        role: params.role,
        scopes: params.scopes,
        signedAtMs: block.signedAt,
        token: params.token,
        nonce: params.nonce,
      });

      const sigBuf = Buffer.from(block.signature, 'base64url');
      const pubKeyDer = Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        identity.publicKeyRaw,
      ]);
      const pubKey = crypto.createPublicKey({ key: pubKeyDer, format: 'der', type: 'spki' });

      const valid = crypto.verify(null, Buffer.from(expectedPayload, 'utf8'), pubKey, sigBuf);
      expect(valid).toBe(true);

      logSpy.mockRestore();
    });

    it('uses the cached identity (same device ID)', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const block1 = createDeviceBlock({
        clientId: 'c', clientMode: 'm', role: 'r',
        scopes: [], token: '', nonce: 'n1',
      });
      const block2 = createDeviceBlock({
        clientId: 'c', clientMode: 'm', role: 'r',
        scopes: [], token: '', nonce: 'n2',
      });
      logSpy.mockRestore();

      expect(block1.id).toBe(block2.id);
      expect(block1.publicKey).toBe(block2.publicKey);
      expect(block1.signature).not.toBe(block2.signature);
    });
  });

  describe('Gateway device-token storage', () => {
    it('normalizes HTTP Gateway URLs to a stable WebSocket key', () => {
      expect(normalizeGatewayAuthKey('https://gateway.example.test?ignored=1#hash'))
        .toBe('wss://gateway.example.test/ws');
      expect(normalizeGatewayAuthKey('ws://127.0.0.1:18789/ws?token=secret'))
        .toBe('ws://127.0.0.1:18789/ws');
    });

    it('persists a read/write/approval device token in a server-only mode-0600 file', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      storeDeviceAuth({
        gatewayUrl: 'https://gateway.example.test',
        token: 'device-token-secret',
        role: 'operator',
        scopes: ['operator.read', 'operator.write', 'operator.approvals'],
      });

      expect(getStoredDeviceAuth('wss://gateway.example.test/ws')).toMatchObject({
        token: 'device-token-secret',
        role: 'operator',
        scopes: ['operator.read', 'operator.write', 'operator.approvals'],
      });

      const authPath = path.join(tmpDir, 'gateway-auth.json');
      const stored = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      expect(stored.gateways['wss://gateway.example.test/ws'].token)
        .toBe('device-token-secret');
      expect(fs.statSync(authPath).mode & 0o777).toBe(0o600);
      logSpy.mockRestore();
    });

    it('isolates device tokens by Gateway URL', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      storeDeviceAuth({
        gatewayUrl: 'https://one.example.test',
        token: 'token-one',
        scopes: ['operator.read', 'operator.write', 'operator.approvals'],
      });
      storeDeviceAuth({
        gatewayUrl: 'https://two.example.test',
        token: 'token-two',
        scopes: ['operator.read', 'operator.write', 'operator.approvals'],
      });

      expect(getStoredDeviceAuth('https://one.example.test')?.token).toBe('token-one');
      expect(getStoredDeviceAuth('https://two.example.test')?.token).toBe('token-two');
      logSpy.mockRestore();
    });

    it('rejects under-scoped, over-scoped, or non-operator tokens', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      storeDeviceAuth({
        gatewayUrl: 'https://under-scoped.example.test',
        token: 'read-only-token',
        scopes: ['operator.read'],
      });
      storeDeviceAuth({
        gatewayUrl: 'https://wrong-role.example.test',
        token: 'admin-token',
        role: 'admin',
        scopes: ['operator.read', 'operator.write'],
      });
      storeDeviceAuth({
        gatewayUrl: 'https://over-scoped.example.test',
        token: 'over-scoped-token',
        scopes: ['operator.read', 'operator.write', 'operator.admin'],
      });

      expect(getStoredDeviceAuth('https://under-scoped.example.test')).toBeNull();
      expect(getStoredDeviceAuth('https://wrong-role.example.test')).toBeNull();
      expect(getStoredDeviceAuth('https://over-scoped.example.test')).toBeNull();
      expect(fs.existsSync(path.join(tmpDir, 'gateway-auth.json'))).toBe(false);
      logSpy.mockRestore();
    });

    it('clears only the selected Gateway token', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      for (const [gatewayUrl, token] of [
        ['https://one.example.test', 'token-one'],
        ['https://two.example.test', 'token-two'],
      ]) {
        storeDeviceAuth({
          gatewayUrl,
          token,
          scopes: ['operator.read', 'operator.write', 'operator.approvals'],
        });
      }

      clearStoredDeviceAuth('https://one.example.test');
      expect(getStoredDeviceAuth('https://one.example.test')).toBeNull();
      expect(getStoredDeviceAuth('https://two.example.test')?.token).toBe('token-two');
      logSpy.mockRestore();
    });
  });
});
