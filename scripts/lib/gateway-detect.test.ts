import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  NativeCommandOptions,
  NativeCommandResult,
  NativeCommandRunner,
} from './gateway-detect.js';

interface NativeCall {
  command: string;
  args: string[];
  options?: NativeCommandOptions;
}

function commandResult(
  status: number,
  stdout = '',
  stderr = '',
): NativeCommandResult {
  return { status, stdout, stderr };
}

describe('OpenClaw native gateway configuration', () => {
  const originalEnv = { ...process.env };
  let tempHome = '';
  let dataDir = '';

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    tempHome = mkdtempSync(path.join(os.tmpdir(), 'convosketchpad-gateway-'));
    dataDir = path.join(tempHome, '.convosketchpad');
    process.env.HOME = tempHome;
    process.env.CONVOSKETCHPAD_DATA_DIR = dataDir;
    delete process.env.OPENCLAW_CONFIG_PATH;
    delete process.env.OPENCLAW_BIN;
    delete process.env.OPENCLAW_GATEWAY_TOKEN;

    mkdirSync(path.join(tempHome, '.openclaw'), { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path.join(tempHome, '.openclaw', 'openclaw.json'), JSON.stringify({
      gateway: {
        port: 18789,
        auth: { token: 'detected-token' },
      },
    }));
    writeFileSync(path.join(dataDir, 'device-identity.json'), JSON.stringify({
      deviceId: 'convosketchpad-device',
      publicKeyB64url: 'convosketchpad-public-key',
      privateKeyPem: 'not-used-by-these-tests',
    }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tempHome, { recursive: true, force: true });
  });

  async function loadModule() {
    vi.resetModules();
    return import('./gateway-detect.js');
  }

  it('detects the local Gateway without changing OpenClaw state', async () => {
    const mod = await loadModule();
    expect(mod.detectGatewayConfig()).toEqual({
      token: 'detected-token',
      url: 'http://127.0.0.1:18789',
    });
  });

  it('honours OPENCLAW_CONFIG_PATH for read-only discovery', async () => {
    const customPath = path.join(tempHome, 'custom', 'openclaw.json');
    mkdirSync(path.dirname(customPath), { recursive: true });
    writeFileSync(customPath, JSON.stringify({
      gateway: { port: 19999, auth: { token: 'custom-token' } },
    }));
    process.env.OPENCLAW_CONFIG_PATH = customPath;

    const mod = await loadModule();
    expect(mod.detectGatewayConfig()).toEqual({
      token: 'custom-token',
      url: 'http://127.0.0.1:19999',
    });
  });

  it('keeps the documented token precedence', async () => {
    const mod = await loadModule();
    expect(mod.chooseSetupGatewayToken({
      existingToken: ' existing ',
      detectedToken: 'detected',
      envToken: 'env',
    })).toEqual({ token: 'existing', source: 'existing' });
    expect(mod.chooseSetupGatewayToken({
      detectedToken: ' detected ',
      envToken: 'env',
    })).toEqual({ token: 'detected', source: 'detected' });
    expect(mod.chooseSetupGatewayToken({ envToken: ' env ' }))
      .toEqual({ token: 'env', source: 'env' });
    expect(mod.chooseSetupGatewayToken({}))
      .toEqual({ token: null, source: 'none' });
  });

  it('detects required CLI capabilities instead of relying on a version number', async () => {
    const mod = await loadModule();
    const runner: NativeCommandRunner = (_command, args) => {
      const key = args.join(' ');
      if (key === 'config patch --help') return commandResult(0, '--dry-run');
      if (key === 'devices list --help') return commandResult(0, '--json');
      if (key === 'devices approve --help') return commandResult(0, '<requestId>');
      return commandResult(1);
    };

    expect(mod.detectNativeOpenClawCapabilities(runner)).toEqual({
      configPatch: true,
      devicesList: true,
      devicesApprove: true,
    });
  });

  it('reports missing CLI capabilities individually', async () => {
    const mod = await loadModule();
    const runner: NativeCommandRunner = (_command, args) => (
      args[0] === 'devices' && args[1] === 'list'
        ? commandResult(0, '--json')
        : commandResult(1, '', 'unsupported')
    );

    expect(mod.detectNativeOpenClawCapabilities(runner)).toEqual({
      configPatch: false,
      devicesList: true,
      devicesApprove: false,
    });
  });

  it('merges normalized origins through dry-run and native config patch', async () => {
    const mod = await loadModule();
    const calls: NativeCall[] = [];
    const runner: NativeCommandRunner = (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === 'config' && args[1] === 'get') {
        return commandResult(0, JSON.stringify(['http://localhost:3080']));
      }
      return commandResult(0, '{}');
    };

    const result = mod.ensureGatewayAllowedOrigins([
      ' https://canvas.example.test/path ',
      'https://canvas.example.test',
    ], runner);

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      origins: ['http://localhost:3080', 'https://canvas.example.test'],
    });
    expect(calls.map(call => call.args)).toEqual([
      ['config', 'get', 'gateway.controlUi.allowedOrigins', '--json'],
      [
        'config',
        'patch',
        '--stdin',
        '--replace-path',
        'gateway.controlUi.allowedOrigins',
        '--dry-run',
        '--json',
      ],
      [
        'config',
        'patch',
        '--stdin',
        '--replace-path',
        'gateway.controlUi.allowedOrigins',
      ],
    ]);
    const patch = JSON.parse(String(calls[1].options?.input));
    expect(patch.gateway.controlUi.allowedOrigins).toEqual([
      'http://localhost:3080',
      'https://canvas.example.test',
    ]);
    expect(calls[2].options?.input).toBe(calls[1].options?.input);
  });

  it('treats a missing allowedOrigins path as an empty list', async () => {
    const mod = await loadModule();
    const calls: NativeCall[] = [];
    const runner: NativeCommandRunner = (command, args, options) => {
      calls.push({ command, args, options });
      if (args[1] === 'get') return commandResult(1, '', 'Config path not found');
      return commandResult(0);
    };

    const result = mod.ensureGatewayAllowedOrigins(['http://127.0.0.1:3080'], runner);
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      origins: ['http://127.0.0.1:3080'],
    });
    expect(calls).toHaveLength(3);
  });

  it('does not patch when every required origin is already present', async () => {
    const mod = await loadModule();
    const calls: NativeCall[] = [];
    const runner: NativeCommandRunner = (command, args, options) => {
      calls.push({ command, args, options });
      return commandResult(0, JSON.stringify(['https://canvas.example.test']));
    };

    const result = mod.ensureGatewayAllowedOrigins(['https://canvas.example.test/'], runner);
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(calls).toHaveLength(1);
  });

  it('never applies a patch rejected by OpenClaw dry-run', async () => {
    const mod = await loadModule();
    const calls: NativeCall[] = [];
    const runner: NativeCommandRunner = (command, args, options) => {
      calls.push({ command, args, options });
      if (args[1] === 'get') return commandResult(0, '[]');
      if (args.includes('--dry-run')) return commandResult(1, '', 'invalid patch');
      return commandResult(0);
    };

    const result = mod.ensureGatewayAllowedOrigins(['https://canvas.example.test'], runner);
    expect(result).toMatchObject({ ok: false, changed: false });
    expect(result.message).toContain('invalid patch');
    expect(calls).toHaveLength(2);
  });

  it('approves exactly one matching native pending request', async () => {
    const mod = await loadModule();
    const calls: NativeCall[] = [];
    const runner: NativeCommandRunner = (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === 'devices' && args[1] === 'list') {
        return commandResult(0, JSON.stringify({
          pending: [
            {
              requestId: 'other-request',
              deviceId: 'other-device',
              publicKey: 'other-key',
            },
            {
              requestId: 'canvas-request_1',
              deviceId: 'convosketchpad-device',
              publicKey: 'convosketchpad-public-key',
            },
          ],
        }));
      }
      return commandResult(0);
    };

    const result = mod.approvePendingConvoSketchpadDevice({
      gatewayUrl: 'https://gateway.example.test',
      gatewayToken: 'gateway-token',
      runner,
    });

    expect(result).toEqual({
      ok: true,
      approved: 1,
      requestId: 'canvas-request_1',
      message: 'Approved ConvoSketchpad device request canvas-request_1',
    });
    expect(calls[0].args).toEqual([
      'devices',
      'list',
      '--json',
      '--url',
      'wss://gateway.example.test/ws',
      '--token',
      'gateway-token',
    ]);
    expect(calls[1].args).toEqual([
      'devices',
      'approve',
      'canvas-request_1',
      '--url',
      'wss://gateway.example.test/ws',
      '--token',
      'gateway-token',
    ]);
  });

  it('fails closed for ambiguous or unsafe pairing requests', async () => {
    const mod = await loadModule();
    const approvals: string[][] = [];
    const runner: NativeCommandRunner = (_command, args) => {
      if (args[1] === 'list') {
        return commandResult(0, JSON.stringify({
          pending: [
            {
              requestId: 'first',
              deviceId: 'convosketchpad-device',
              publicKey: 'convosketchpad-public-key',
            },
            {
              requestId: 'second',
              deviceId: 'convosketchpad-device',
              publicKey: 'convosketchpad-public-key',
            },
            {
              requestId: 'unsafe;command',
              deviceId: 'convosketchpad-device',
              publicKey: 'convosketchpad-public-key',
            },
          ],
        }));
      }
      approvals.push(args);
      return commandResult(0);
    };

    const result = mod.approvePendingConvoSketchpadDevice({ runner });
    expect(result).toMatchObject({ ok: false, approved: 0 });
    expect(result.message).toContain('Multiple');
    expect(approvals).toEqual([]);
  });

  it('does not accept a partial identity match', async () => {
    const mod = await loadModule();
    const runner: NativeCommandRunner = (_command, args) => {
      if (args[1] === 'list') {
        return commandResult(0, JSON.stringify({
          pending: [{
            requestId: 'wrong-key',
            deviceId: 'convosketchpad-device',
            publicKey: 'different-public-key',
          }],
        }));
      }
      throw new Error('approve must not be called');
    };

    expect(mod.approvePendingConvoSketchpadDevice({ runner }))
      .toMatchObject({ ok: false, approved: 0 });
  });

  it('never rewrites legacy pairing files', async () => {
    const mod = await loadModule();
    const pairedPath = path.join(tempHome, '.openclaw', 'devices', 'paired.json');
    const deviceAuthPath = path.join(tempHome, '.openclaw', 'identity', 'device-auth.json');
    mkdirSync(path.dirname(pairedPath), { recursive: true });
    mkdirSync(path.dirname(deviceAuthPath), { recursive: true });
    writeFileSync(pairedPath, '{"sentinel":"paired"}\n');
    writeFileSync(deviceAuthPath, '{"sentinel":"device-auth"}\n');

    const runner: NativeCommandRunner = (_command, args) => (
      args[1] === 'list'
        ? commandResult(0, JSON.stringify({ pending: [] }))
        : commandResult(0)
    );
    mod.approvePendingConvoSketchpadDevice({ runner });

    expect(readFileSync(pairedPath, 'utf8')).toBe('{"sentinel":"paired"}\n');
    expect(readFileSync(deviceAuthPath, 'utf8')).toBe('{"sentinel":"device-auth"}\n');
  });

  it('only requests read/write operator scopes', async () => {
    const mod = await loadModule();
    expect(mod.requiredOperatorScopes()).toEqual(['operator.read', 'operator.write']);
  });

  it('models the only supported config mutation as allowed origins', async () => {
    const mod = await loadModule();
    const changes = mod.detectNeededConfigChanges({
      allowedOrigins: ['https://canvas.example.test'],
    });
    expect(changes.map(change => change.id)).toEqual(['allowed-origins']);
    expect(changes[0].description).toContain('Gateway allowed origins');
  });
});
