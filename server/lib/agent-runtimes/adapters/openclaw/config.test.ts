import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('OpenClaw Adapter configuration', () => {
  it('owns Gateway URL, token, and timezone validation inside the Adapter', async () => {
    vi.stubEnv('OPENCLAW_GATEWAY_URL', 'https://gateway.example.test');
    vi.stubEnv('OPENCLAW_GATEWAY_TOKEN', 'secret');
    vi.stubEnv('OPENCLAW_GATEWAY_TIMEZONE', 'Asia/Shanghai');
    const { openClawConfig, validateOpenClawConfig } = await import('./config.js');

    expect(openClawConfig).toEqual({
      gatewayUrl: 'https://gateway.example.test',
      gatewayToken: 'secret',
      gatewayTimezone: 'Asia/Shanghai',
    });
    expect(validateOpenClawConfig()).toEqual({ warnings: [], errors: [] });
  });

  it('reports invalid timezones without terminating the process', async () => {
    vi.stubEnv('OPENCLAW_GATEWAY_TOKEN', 'secret');
    vi.stubEnv('OPENCLAW_GATEWAY_TIMEZONE', 'not/a-timezone');
    const { validateOpenClawConfig } = await import('./config.js');

    expect(validateOpenClawConfig().errors).toEqual([
      expect.stringContaining('Invalid OPENCLAW_GATEWAY_TIMEZONE'),
    ]);
  });
});
