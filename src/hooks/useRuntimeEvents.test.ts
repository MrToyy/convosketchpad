import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRuntimeEvents } from './useRuntimeEvents';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
  constructor(public url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(type, listener as (event: MessageEvent<string>) => void);
  }
  close() {}
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

const connected = {
  overallState: 'ready',
  backends: [{ backendId: 'openclaw', state: 'connected', restartSupported: true }],
  updatedAt: 1,
};

describe('product runtime transport', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(connected), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads aggregate status and connects only to product HTTP/SSE endpoints', async () => {
    const { result } = renderHook(() => useRuntimeEvents());
    await waitFor(() => expect(result.current.overallState).toBe('ready'));
    expect(result.current.backendStatuses.openclaw.state).toBe('connected');
    expect(fetch).toHaveBeenCalledWith('/api/runtime/status', { credentials: 'include' });
    expect(FakeEventSource.instances[0]?.url).toBe('/api/runtime/events');
  });

  it('applies only unified Backend status events', async () => {
    const { result } = renderHook(() => useRuntimeEvents());
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    act(() => FakeEventSource.instances[0].emit('runtime.backend_status_changed', {
      overallState: 'unavailable',
      backends: [{ backendId: 'openclaw', state: 'disconnected' }],
      updatedAt: 2,
    }));
    expect(result.current.overallState).toBe('unavailable');
    expect(result.current.backendStatuses.openclaw.state).toBe('disconnected');
  });
});
