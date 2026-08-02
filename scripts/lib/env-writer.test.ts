import { describe, expect, it } from 'vitest';
import { generateEnvContent, type EnvConfig } from './env-writer.js';

describe('ConvoSketchpad env writer', () => {
  it('writes every supported branded runtime setting', () => {
    const content = generateEnvContent({
      OPENCLAW_GATEWAY_TOKEN: 'gateway-token',
      OPENCLAW_GATEWAY_TIMEZONE: 'Asia/Shanghai',
      CONVOSKETCHPAD_DATA_DIR: '/srv/convosketchpad',
      CONVOSKETCHPAD_AUTH: 'true',
      CONVOSKETCHPAD_SESSION_SECRET: 'session-secret',
      CONVOSKETCHPAD_SESSION_TTL: '86400000',
      CONVOSKETCHPAD_AUTH_MAX_FAILURES: '5',
      CONVOSKETCHPAD_AUTH_FAILURE_WINDOW: '600000',
      CONVOSKETCHPAD_AUTH_LOCKOUT: '900000',
      CONVOSKETCHPAD_ALLOW_INSECURE: 'false',
    });

    expect(content).toContain('# ConvoSketchpad Configuration');
    expect(content).toContain('OPENCLAW_GATEWAY_TIMEZONE=Asia/Shanghai');
    expect(content).not.toContain('CONVOSKETCHPAD_PUBLIC_ORIGIN');
    expect(content).not.toContain('WS_ALLOWED_HOSTS');
    expect(content).not.toContain('CSP_CONNECT_EXTRA');
    expect(content).not.toContain('SSL_PORT');
    expect(content).not.toContain('VITE_DISABLE_HTTPS');
    expect(content).not.toContain('VITE_HOST');
    expect(content).not.toContain('VITE_PORT');
    expect(content).not.toContain('CONVOSKETCHPAD_WORKSPACE_ROOT');
    expect(content).not.toContain('CONVOSKETCHPAD_UPLOAD_STAGING_TEMP_DIR');
    expect(content).not.toContain('SESSIONS_DIR');
    expect(content).not.toContain('USAGE_FILE');
    expect(content).toContain('CONVOSKETCHPAD_DATA_DIR=/srv/convosketchpad');
    expect(content).toContain('CONVOSKETCHPAD_AUTH=true');
    expect(content).toContain('CONVOSKETCHPAD_SESSION_SECRET=session-secret');
    expect(content).toContain('CONVOSKETCHPAD_SESSION_TTL=86400000');
    expect(content).toContain('CONVOSKETCHPAD_AUTH_MAX_FAILURES=5');
    expect(content).toContain('CONVOSKETCHPAD_AUTH_FAILURE_WINDOW=600000');
    expect(content).toContain('CONVOSKETCHPAD_AUTH_LOCKOUT=900000');
    expect(content).toContain('CONVOSKETCHPAD_ALLOW_INSECURE=false');
    expect(content).not.toContain('NERVE_');
  });

  it('drops legacy Vite listener settings from regenerated env files', () => {
    const legacyConfig = {
      OPENCLAW_GATEWAY_TOKEN: 'gateway-token',
      PORT: '3080',
      HOST: '127.0.0.1',
      VITE_HOST: '0.0.0.0',
      VITE_PORT: '4000',
    } as unknown as EnvConfig;

    const content = generateEnvContent(legacyConfig);
    expect(content).toContain('PORT=3080');
    expect(content).not.toContain('VITE_HOST');
    expect(content).not.toContain('VITE_PORT');
  });
});
