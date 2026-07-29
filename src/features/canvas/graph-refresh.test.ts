import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasApiError } from './api';
import {
  createGraphRefreshController,
  graphNeedsFallbackPolling,
  GRAPH_EVENT_REFRESH_DELAY_MS,
} from './graph-refresh';

afterEach(() => {
  vi.useRealTimers();
});

describe('Graph refresh policy', () => {
  it('uses fallback polling only while the event stream is unavailable and work is pending', () => {
    expect(graphNeedsFallbackPolling('connected', true)).toBe(false);
    expect(graphNeedsFallbackPolling('reconnecting', true)).toBe(true);
    expect(graphNeedsFallbackPolling('disconnected', false)).toBe(false);
  });

  it('coalesces an event burst into one request', async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValue(undefined);
    const controller = createGraphRefreshController(load, vi.fn());

    for (let index = 0; index < 100; index += 1) controller.schedule();
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(GRAPH_EVENT_REFRESH_DELAY_MS);
    expect(load).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('keeps one request in flight and performs one trailing refresh', async () => {
    vi.useFakeTimers();
    let release: (() => void) | null = null;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const load = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue(undefined);
    const controller = createGraphRefreshController(load, vi.fn());

    const running = controller.run();
    const joined = controller.run();
    expect(load).toHaveBeenCalledTimes(1);
    release!();
    await Promise.all([running, joined]);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('honors Retry-After without allowing a trailing request to bypass it', async () => {
    vi.useFakeTimers();
    const load = vi.fn()
      .mockRejectedValueOnce(new CanvasApiError('Too many requests', 429, 2_500))
      .mockResolvedValue(undefined);
    const controller = createGraphRefreshController(load, vi.fn());

    const running = controller.run();
    void controller.run();
    await running;
    await vi.advanceTimersByTimeAsync(2_499);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
});
