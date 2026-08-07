import { describe, expect, it } from 'vitest';
import {
  applyAccessPlanToConfig,
  buildAccessPlan,
  normalizeBrowserOrigin,
  parseBrowserOrigins,
} from './access-plan.js';

const tailscale = {
  installed: true,
  authenticated: true,
  ipv4: '100.64.0.42',
  dnsName: 'example-node.tail0000.ts.net',
  serveOrigins: ['https://example-node.tail0000.ts.net'],
  serveRoutes: [{
    origin: 'https://example-node.tail0000.ts.net',
    proxyTargets: ['http://127.0.0.1:3080'],
  }],
};

describe('buildAccessPlan', () => {
  it('models only the browser-facing ConvoSketchpad origin', () => {
    expect(buildAccessPlan({ profile: 'tailscale-ip', port: '3080', tailscale })).toEqual({
      profile: 'tailscale-ip',
      bindHost: '100.64.0.42',
      browserOrigins: ['http://100.64.0.42:3080'],
      trustedProxies: [],
      remoteAccess: true,
      followUpSteps: [],
    });
  });

  it('uses loopback with a Tailscale Serve origin', () => {
    expect(buildAccessPlan({ profile: 'tailscale-serve', port: '3080', tailscale })).toMatchObject({
      bindHost: '127.0.0.1',
      browserOrigins: ['https://example-node.tail0000.ts.net'],
      remoteAccess: true,
    });
  });

  it('adds a follow-up when Tailscale Serve is not ready', () => {
    const plan = buildAccessPlan({
      profile: 'tailscale-serve',
      port: '3080',
      tailscale: { ...tailscale, serveOrigins: [], serveRoutes: [] },
    });
    expect(plan.followUpSteps[0]).toContain('tailscale serve --bg http://127.0.0.1:3080');
  });
});

describe('applyAccessPlanToConfig', () => {
  it('writes only HOST and browser API ALLOWED_ORIGINS', () => {
    expect(applyAccessPlanToConfig(
      { PORT: '3080', OPENCLAW_GATEWAY_URL: 'http://10.0.0.5:18789' },
      buildAccessPlan({ profile: 'tailscale-ip', port: '3080', tailscale }),
    )).toEqual({
      PORT: '3080',
      OPENCLAW_GATEWAY_URL: 'http://10.0.0.5:18789',
      HOST: '100.64.0.42',
      ALLOWED_ORIGINS: 'http://100.64.0.42:3080',
    });
  });

  it('clears stale browser and proxy settings when returning to local mode', () => {
    expect(applyAccessPlanToConfig(
      {
        HOST: '0.0.0.0',
        ALLOWED_ORIGINS: 'https://old.example.test',
        TRUSTED_PROXIES: '10.0.0.2',
      },
      buildAccessPlan({ profile: 'local', port: '3080' }),
    )).toEqual({ HOST: '127.0.0.1' });
  });
});

describe('browser origin parsing', () => {
  it('accepts exact HTTP(S) origins and normalizes duplicates', () => {
    expect(parseBrowserOrigins(
      'https://canvas.example.test, https://canvas.example.test:443, http://10.0.0.5:3080',
    )).toEqual(['https://canvas.example.test', 'http://10.0.0.5:3080']);
  });

  it('rejects paths, credentials, wildcards and unsupported protocols', () => {
    expect(normalizeBrowserOrigin('https://example.test/path')).toBeNull();
    expect(normalizeBrowserOrigin('https://user:pass@example.test')).toBeNull();
    expect(normalizeBrowserOrigin('https://*.example.test')).toBeNull();
    expect(normalizeBrowserOrigin('*')).toBeNull();
    expect(normalizeBrowserOrigin('file:///tmp/canvas')).toBeNull();
  });
});
