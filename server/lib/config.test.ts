import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { config, printStartupBanner, SESSION_COOKIE_NAME, validateConfig, WS_ALLOWED_HOSTS } from './config.js';

describe('Canvas server config', () => {
  it('contains only the runtime paths and limits used by retained features', () => {
    expect(config.gatewayUrl).toMatch(/^https?:\/\//);
    expect(() =>
      new Intl.DateTimeFormat('en-US', { timeZone: config.gatewayTimezone }).format()
    ).not.toThrow();
    expect(path.basename(config.canvasDatabasePath)).toBe('canvas.sqlite');
    expect(path.basename(config.canvasArtifactsPath)).toBe('artifacts');
    expect(config.limits.maxBodyBytes).toBeGreaterThan(80 * 1024 * 1024);
  });

  it('keeps auth and WebSocket host defaults', () => {
    expect(SESSION_COOKIE_NAME).toBe(`nerve_session_${config.port}`);
    expect(WS_ALLOWED_HOSTS).toEqual(expect.objectContaining({}));
    expect(WS_ALLOWED_HOSTS.has('localhost')).toBe(true);
  });

  it('prints the Canvas product name and validates without throwing', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    printStartupBanner('1.2.3');
    expect(log.mock.calls.flat().join(' ')).toContain('ConvoSketchpad v1.2.3');
    expect(() => validateConfig()).not.toThrow();
    log.mockRestore();
    warn.mockRestore();
  });
});
