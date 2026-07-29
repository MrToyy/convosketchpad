import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRuntimeEvents } from './useRuntimeEvents';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(type, listener as (event: MessageEvent<string>) => void);
  }
  close() {}
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

describe('product runtime transport', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      state: 'connected',
      gatewayRestartSupported: true,
      methods: ['chat.send'],
      maxPayload: 1024,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('connects only to ConvoSketchpad HTTP/SSE endpoints', async () => {
    const { result } = renderHook(() => useRuntimeEvents());
    await waitFor(() => expect(result.current.connectionState).toBe('connected'));
    expect(fetch).toHaveBeenCalledWith('/api/runtime/status', { credentials: 'include' });
    expect(FakeEventSource.instances[0]?.url).toBe('/api/runtime/events');
    expect(result.current.gatewayRestartSupported).toBe(true);
  });

  it('does not confuse EventSource reconnects with Gateway state', async () => {
    const { result } = renderHook(() => useRuntimeEvents());
    await waitFor(() => expect(result.current.connectionState).toBe('connected'));
    act(() => {
      FakeEventSource.instances[0]?.onerror?.();
    });
    expect(result.current.connectionState).toBe('connected');
  });

  it('uses the runtime stream only for Gateway status', async () => {
    const { result } = renderHook(() => useRuntimeEvents());
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0].emit('interaction.started', {
      branchId: 'branch-1',
      interactionId: 'interaction-1',
    });
    expect(result.current.connectionState).toBe('connected');
    act(() => {
      FakeEventSource.instances[0].emit('runtime.connection_changed', {
        payload: { state: 'disconnected', gatewayRestartSupported: false, methods: [] },
      });
    });
    expect(result.current.connectionState).toBe('disconnected');
    expect(result.current.gatewayRestartSupported).toBe(false);
  });
});
