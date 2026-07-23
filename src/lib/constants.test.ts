import { describe, expect, it } from 'vitest';
import {
  CONTEXT_CRITICAL_THRESHOLD,
  CONTEXT_WARNING_THRESHOLD,
  DEFAULT_GATEWAY_WS,
} from './constants';

describe('Canvas client constants', () => {
  it('keeps a local Gateway placeholder', () => {
    expect(DEFAULT_GATEWAY_WS).toBe('ws://127.0.0.1:18789');
  });

  it('orders context meter thresholds', () => {
    expect(CONTEXT_WARNING_THRESHOLD).toBeLessThan(CONTEXT_CRITICAL_THRESHOLD);
    expect(CONTEXT_CRITICAL_THRESHOLD).toBeLessThan(100);
  });
});
