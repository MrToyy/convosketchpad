import { describe, expect, it } from 'vitest';
import {
  canvasSendRetryDelay,
  canvasSendRetryWakeAt,
} from './send-retry.js';

describe('Canvas send retry scheduling', () => {
  it('uses bounded progressive retry delays', () => {
    expect([1, 2, 3, 4, 5].map(canvasSendRetryDelay))
      .toEqual([1_000, 3_000, 10_000, 30_000, 60_000]);
    expect(canvasSendRetryDelay(20)).toBe(60_000);
  });

  it('keeps no timer while idle and wakes at the persisted next attempt', () => {
    expect(canvasSendRetryWakeAt(null, 1_000, false)).toBeNull();
    expect(canvasSendRetryWakeAt(5_000, 1_000, false)).toBe(5_000);
    expect(canvasSendRetryWakeAt(500, 1_000, false)).toBe(1_000);
  });

  it('avoids a tight loop while the same reservation is actively dispatching', () => {
    expect(canvasSendRetryWakeAt(500, 1_000, true)).toBe(1_250);
  });
});
