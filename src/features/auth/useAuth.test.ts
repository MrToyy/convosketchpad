/** Tests for useAuth hook. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

describe('useAuth', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function importUseAuth(statusResponse: Record<string, unknown> = { authEnabled: false, authenticated: true }) {
    // Mock fetch before importing the module (module fires fetch on load)
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/auth/status')) {
        return { ok: true, json: async () => statusResponse };
      }
      if (typeof url === 'string' && url.includes('/api/auth/login')) {
        const body = JSON.parse(opts?.body as string || '{}');
        if (body.token === 'correct') {
          return { ok: true, json: async () => ({ ok: true }) };
        }
        return { ok: true, json: async () => ({ ok: false, error: 'Invalid token' }) };
      }
      if (typeof url === 'string' && url.includes('/api/auth/logout')) {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const mod = await import('./useAuth.js');
    return mod.useAuth;
  }

  it('resolves to authenticated when auth is disabled', async () => {
    const useAuth = await importUseAuth({ authEnabled: false, authenticated: true });
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.state).toBe('authenticated');
    });
  });

  it('resolves to login when auth is enabled and not authenticated', async () => {
    const useAuth = await importUseAuth({ authEnabled: true, authenticated: false });
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.state).toBe('login');
    });
  });

  it('login with a valid token transitions to authenticated', async () => {
    const useAuth = await importUseAuth({ authEnabled: true, authenticated: false });
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.state).toBe('login');
    });

    await act(async () => {
      await result.current.login('correct');
    });

    expect(result.current.state).toBe('authenticated');
  });

  it('login failure sets an error', async () => {
    const useAuth = await importUseAuth({ authEnabled: true, authenticated: false });
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.state).toBe('login');
    });

    await act(async () => {
      await result.current.login('wrong');
    });

    expect(result.current.error).toContain('Invalid token');
    expect(result.current.state).toBe('login');
  });

  it('logout transitions to login', async () => {
    const useAuth = await importUseAuth({ authEnabled: false, authenticated: true });
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.state).toBe('authenticated');
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.state).toBe('login');
  });

  it('handles fetch failure gracefully', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.resetModules();

    const mod = await import('./useAuth.js');
    const { result } = renderHook(() => mod.useAuth());

    // On fetch failure, should default to authenticated
    await waitFor(() => {
      expect(result.current.state).toBe('authenticated');
    });
  });
});
