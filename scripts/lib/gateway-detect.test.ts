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
  NativeCommandResult,
  NativeCommandRunner,
} from './gateway-detect.js';

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

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    tempHome = mkdtempSync(path.join(os.tmpdir(), 'convosketchpad-gateway-'));
    process.env.HOME = tempHome;
    delete process.env.OPENCLAW_CONFIG_PATH;
    delete process.env.OPENCLAW_BIN;
    delete process.env.OPENCLAW_GATEWAY_TOKEN;

    mkdirSync(path.join(tempHome, '.openclaw'), { recursive: true });
    writeFileSync(path.join(tempHome, '.openclaw', 'openclaw.json'), JSON.stringify({
      gateway: {
        port: 18789,
        auth: { token: 'detected-token' },
      },
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

  it('detects the local Gateway through native config commands', async () => {
    const mod = await loadModule();
    const calls: string[] = [];
    const runner: NativeCommandRunner = (_command, args) => {
      calls.push(args.join(' '));
      if (args[2] === 'gateway.auth.token') return commandResult(0, '"detected-token"');
      if (args[2] === 'gateway.port') return commandResult(0, '18789');
      return commandResult(1);
    };
    expect(mod.detectGatewayConfig(runner)).toEqual({
      token: 'detected-token',
      url: 'http://127.0.0.1:18789',
    });
    expect(calls).toEqual([
      'config get gateway.auth.token --json',
      'config get gateway.port --json',
    ]);
  });

  it('leaves OPENCLAW_CONFIG_PATH to the native CLI instead of opening it', async () => {
    const customPath = path.join(tempHome, 'custom', 'openclaw.json');
    mkdirSync(path.dirname(customPath), { recursive: true });
    writeFileSync(customPath, JSON.stringify({
      gateway: { port: 19999, auth: { token: 'custom-token' } },
    }));
    process.env.OPENCLAW_CONFIG_PATH = customPath;

    const mod = await loadModule();
    const runner: NativeCommandRunner = (_command, args) => {
      if (args[2] === 'gateway.auth.token') return commandResult(0, '"custom-token"');
      if (args[2] === 'gateway.port') return commandResult(0, '19999');
      return commandResult(1);
    };
    expect(mod.detectGatewayConfig(runner)).toEqual({
      token: 'custom-token',
      url: 'http://127.0.0.1:19999',
    });
    expect(readFileSync(customPath, 'utf8')).toContain('custom-token');
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

});
