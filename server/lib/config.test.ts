import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { config, printStartupBanner, SESSION_COOKIE_NAME, validateConfig } from './config.js';

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

  it('keeps the managed session cookie scoped to the server port', () => {
    expect(SESSION_COOKIE_NAME).toBe(`convosketchpad_session_${config.port}`);
  });

  it('prints the Canvas product name and validates without throwing', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    printStartupBanner(
      '1.2.3',
      'A visual branching workspace for agents — revisit any point and continue exploring.',
    );
    expect(log.mock.calls.flat().join(' ')).toContain('ConvoSketchpad v1.2.3');
    expect(log.mock.calls.flat().join(' ')).toContain(
      'A visual branching workspace for agents — revisit any point and continue exploring.',
    );
    expect(() => validateConfig()).not.toThrow();
    log.mockRestore();
    warn.mockRestore();
  });
});
