import { afterEach, describe, expect, it, vi } from 'vitest';

const EXAMPLE_TS_DNS = 'example-node.tail0000.ts.net';
const EXAMPLE_TS_IPV4 = '100.64.0.42';

describe('checkPrerequisites', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('includes Tailscale authentication, dns name, and serve origins when available', async () => {
    vi.doMock('./tailscale.js', () => ({
      getTailscaleState: () => ({
        installed: true,
        authenticated: true,
        ipv4: EXAMPLE_TS_IPV4,
        dnsName: EXAMPLE_TS_DNS,
        serveOrigins: [`https://${EXAMPLE_TS_DNS}`],
        serveRoutes: [{
          origin: `https://${EXAMPLE_TS_DNS}`,
          proxyTargets: ['http://127.0.0.1:3080'],
        }],
      }),
    }));

    const { checkPrerequisites } = await import('./prereq-check.js');
    const result = checkPrerequisites({ quiet: true });

    expect(result.tailscale).toEqual({
      installed: true,
      authenticated: true,
      ipv4: EXAMPLE_TS_IPV4,
      dnsName: EXAMPLE_TS_DNS,
      serveOrigins: [`https://${EXAMPLE_TS_DNS}`],
      serveRoutes: [{
        origin: `https://${EXAMPLE_TS_DNS}`,
        proxyTargets: ['http://127.0.0.1:3080'],
      }],
    });
  });

  it('enforces the complete Node.js minimum version', async () => {
    const { checkPrerequisites } = await import('./prereq-check.js');

    expect(checkPrerequisites({ quiet: true, nodeVersion: 'v22.22.1' }).nodeOk).toBe(false);
    expect(checkPrerequisites({ quiet: true, nodeVersion: 'v22.22.2' }).nodeOk).toBe(true);
  });
});
