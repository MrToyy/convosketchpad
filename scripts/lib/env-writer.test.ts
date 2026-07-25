import { describe, expect, it } from 'vitest';
import { generateEnvContent } from './env-writer.js';

describe('ConvoSketchpad env writer', () => {
  it('writes every supported branded runtime setting', () => {
    const content = generateEnvContent({
      GATEWAY_TOKEN: 'gateway-token',
      CONVOSKETCHPAD_GATEWAY_TIMEZONE: 'Asia/Shanghai',
      CONVOSKETCHPAD_PUBLIC_ORIGIN: 'https://canvas.example.test',
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
    expect(content).toContain('CONVOSKETCHPAD_GATEWAY_TIMEZONE=Asia/Shanghai');
    expect(content).toContain('CONVOSKETCHPAD_PUBLIC_ORIGIN=https://canvas.example.test');
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
});
