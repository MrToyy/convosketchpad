import { describe, expect, it } from 'vitest';
import { LoginFailureTracker } from './login-failures.js';

const policy = { maxFailures: 3, windowMs: 30 * 60_000, lockoutMs: 30 * 60_000, maxEntries: 2 };

describe('LoginFailureTracker', () => {
  it('locks an IP on its third failed token verification', () => {
    const tracker = new LoginFailureTracker(policy);
    expect(tracker.recordFailure('one', 1_000)).toMatchObject({ locked: false, remainingAttempts: 2 });
    expect(tracker.recordFailure('one', 2_000)).toMatchObject({ locked: false, remainingAttempts: 1 });
    expect(tracker.recordFailure('one', 3_000)).toMatchObject({ locked: true, retryAfterSeconds: 1_800 });
    expect(tracker.check('one', 4_000).locked).toBe(true);
  });

  it('keeps failure counters isolated by client IP', () => {
    const tracker = new LoginFailureTracker(policy);
    tracker.recordFailure('one', 1_000);
    tracker.recordFailure('one', 2_000);
    expect(tracker.check('two', 2_000)).toMatchObject({ locked: false, remainingAttempts: 3 });
  });

  it('clears failures after a successful login', () => {
    const tracker = new LoginFailureTracker(policy);
    tracker.recordFailure('one', 1_000);
    tracker.recordSuccess('one');
    expect(tracker.check('one', 2_000)).toMatchObject({ locked: false, remainingAttempts: 3 });
  });

  it('expires failure windows and completed lockouts', () => {
    const tracker = new LoginFailureTracker(policy);
    tracker.recordFailure('one', 1_000);
    expect(tracker.check('one', policy.windowMs + 1_001).remainingAttempts).toBe(3);
    tracker.recordFailure('one', 2_000_000);
    tracker.recordFailure('one', 2_000_001);
    tracker.recordFailure('one', 2_000_002);
    expect(tracker.check('one', 2_000_002 + policy.lockoutMs + 1).locked).toBe(false);
  });

  it('evicts the least recently touched entry at the capacity limit', () => {
    const tracker = new LoginFailureTracker(policy);
    tracker.recordFailure('oldest', 1_000);
    tracker.recordFailure('newer', 2_000);
    tracker.recordFailure('third', 3_000);
    expect(tracker.size).toBe(2);
    expect(tracker.check('oldest', 3_000).remainingAttempts).toBe(3);
  });
});
