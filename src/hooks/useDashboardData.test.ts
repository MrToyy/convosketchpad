import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDashboardData } from './useDashboardData';
import type { RuntimeUsageData } from '@/types';

function tokenData(totalCost: number): RuntimeUsageData {
  return {
    backends: [{
      backendId: 'openclaw',
      displayName: 'OpenClaw',
      available: true,
      usage: { totalCost, totalInput: 10, totalOutput: 20, totalCacheRead: 30, updatedAt: 123, source: 'openclaw-gateway', currency: 'USD', period: 'all-time', additive: true },
    }],
    comparableCostTotal: { currency: 'USD', amount: totalCost },
    updatedAt: 123,
  };
}

function tokenResponse(totalCost: number): Response {
  return new Response(JSON.stringify(tokenData(totalCost)), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useDashboardData', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads usage on demand and reuses the first result', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse(42));
    const { result } = renderHook(() => useDashboardData());

    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => result.current.ensureTokens());

    expect(result.current.tokenData).toEqual(tokenData(42));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/usage', expect.objectContaining({ signal: expect.any(AbortSignal) }));

    await act(async () => result.current.ensureTokens());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes only when explicitly requested', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(tokenResponse(1))
      .mockResolvedValueOnce(tokenResponse(2));
    const { result } = renderHook(() => useDashboardData());

    await act(async () => result.current.ensureTokens());
    expect(result.current.tokenData).toEqual(tokenData(1));

    await act(async () => result.current.refreshTokens());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.tokenData).toEqual(tokenData(2));
  });

  it('keeps stale data and exposes a non-blocking error after refresh failure', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(tokenResponse(1))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const { result } = renderHook(() => useDashboardData());

    await act(async () => result.current.ensureTokens());
    await act(async () => result.current.refreshTokens());

    expect(result.current.tokenData).toEqual(tokenData(1));
    expect(result.current.loadError).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('aborts an in-flight usage request on unmount', () => {
    let requestSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => {});
    });
    const { result, unmount } = renderHook(() => useDashboardData());

    act(() => { void result.current.ensureTokens(); });
    unmount();

    expect(requestSignal?.aborted).toBe(true);
  });
});
