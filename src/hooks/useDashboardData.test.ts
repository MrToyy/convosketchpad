import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboardData } from './useDashboardData';
import type { TokenData } from '@/types';

vi.mock('@/contexts/RuntimeContext', () => ({
  useRuntime: () => ({ connectionState: 'connected' }),
}));

function tokenResponse(totalTokens: number): Response {
  return { ok: true, json: async () => ({ totalTokens }) } as Response;
}

describe('useDashboardData', () => {
  beforeEach(() => {
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('loads Canvas usage data without requesting removed dashboard resources', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse(42));
    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.tokenData).toEqual({ totalTokens: 42 } as TokenData));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/tokens', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('refreshes usage on the independent usage interval', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(tokenResponse(1))
      .mockResolvedValueOnce(tokenResponse(2));
    const { result } = renderHook(() => useDashboardData());

    act(() => { vi.advanceTimersByTime(0); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.tokenData).toEqual({ totalTokens: 1 });

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    await act(async () => { await Promise.resolve(); });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.tokenData).toEqual({ totalTokens: 2 });
  });
});
