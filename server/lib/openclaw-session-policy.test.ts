import { describe, expect, it } from 'vitest';
import {
  latestDailyResetBoundary,
  resolveOpenClawResetPolicy,
  sessionWillResetBeforeSend,
} from './openclaw-session-policy.js';

describe('OpenClaw session reset policy', () => {
  it('matches OpenClaw defaults and legacy idle behavior', () => {
    expect(resolveOpenClawResetPolicy(undefined)).toEqual({
      mode: 'daily',
      atHour: 4,
      idleMinutes: null,
    });
    expect(resolveOpenClawResetPolicy({ idleMinutes: 90 })).toEqual({
      mode: 'idle',
      atHour: 4,
      idleMinutes: 90,
    });
    expect(resolveOpenClawResetPolicy({
      reset: { mode: 'idle', idleMinutes: 0.5 },
    }).idleMinutes).toBeNull();
  });

  it('applies channel, direct-type, and base precedence', () => {
    expect(resolveOpenClawResetPolicy({
      reset: { mode: 'daily', atHour: 2, idleMinutes: 300 },
      resetByType: { direct: { atHour: 5, idleMinutes: 120 } },
    })).toEqual({ mode: 'daily', atHour: 5, idleMinutes: 120 });

    expect(resolveOpenClawResetPolicy({
      reset: { mode: 'daily', atHour: 2 },
      resetByType: { direct: { mode: 'idle', idleMinutes: 120 } },
      resetByChannel: { webchat: { mode: 'daily', atHour: 7 } },
      idleMinutes: 15,
    })).toEqual({ mode: 'daily', atHour: 7, idleMinutes: null });
  });

  it('computes reset boundaries in the configured timezone, including DST offsets', () => {
    expect(
      new Date(latestDailyResetBoundary(
        Date.parse('2026-07-23T02:00:00Z'),
        4,
        'Asia/Shanghai',
      )).toISOString(),
    ).toBe('2026-07-22T20:00:00.000Z');

    expect(
      new Date(latestDailyResetBoundary(
        Date.parse('2026-07-23T10:00:00Z'),
        4,
        'America/New_York',
      )).toISOString(),
    ).toBe('2026-07-23T08:00:00.000Z');
    expect(
      new Date(latestDailyResetBoundary(
        Date.parse('2026-01-23T10:00:00Z'),
        4,
        'America/New_York',
      )).toISOString(),
    ).toBe('2026-01-23T09:00:00.000Z');

    expect(
      new Date(latestDailyResetBoundary(
        Date.parse('2026-03-08T08:00:00Z'),
        2,
        'America/New_York',
      )).toISOString(),
    ).toBe('2026-03-08T07:00:00.000Z');
    expect(
      new Date(latestDailyResetBoundary(
        Date.parse('2026-11-01T08:00:00Z'),
        1,
        'America/New_York',
      )).toISOString(),
    ).toBe('2026-11-01T05:00:00.000Z');
  });

  it('forces recovery for missing lifecycle data and before daily or idle expiry', () => {
    const now = Date.parse('2026-07-23T19:59:30Z');
    expect(sessionWillResetBeforeSend({
      policy: { mode: 'daily', atHour: 4, idleMinutes: null },
      sessionStartedAt: null,
      lastInteractionAt: now,
      now,
      timeZone: 'Asia/Shanghai',
    })).toBe(true);
    expect(sessionWillResetBeforeSend({
      policy: { mode: 'daily', atHour: 4, idleMinutes: null },
      sessionStartedAt: Date.parse('2026-07-22T20:01:00Z'),
      lastInteractionAt: now,
      now,
      timeZone: 'Asia/Shanghai',
    })).toBe(true);
    expect(sessionWillResetBeforeSend({
      policy: { mode: 'idle', atHour: 4, idleMinutes: 30 },
      sessionStartedAt: now - 60_000,
      lastInteractionAt: now - 29 * 60_000 - 30_001,
      now,
      timeZone: 'Asia/Shanghai',
    })).toBe(true);
  });
});
