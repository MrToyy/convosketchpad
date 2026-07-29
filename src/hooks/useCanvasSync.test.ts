import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasSync } from './useCanvasSync';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
  readonly close = vi.fn();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(type, listener as (event: MessageEvent<string>) => void);
  }

  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

describe('Canvas sync transport', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('starts from the snapshot cursor, applies sync/preview events, and cleans up', () => {
    const onSync = vi.fn();
    const onPreview = vi.fn();
    const onDisconnect = vi.fn();
    const { result, unmount } = renderHook(() => useCanvasSync({
      canvasId: 'canvas-1',
      cursor: 7,
      onSync,
      onPreview,
      onDisconnect,
    }));
    const source = FakeEventSource.instances[0];
    expect(source.url).toBe('/api/canvas/canvases/canvas-1/events?after=7');
    act(() => source.onopen?.());
    expect(result.current).toBe('connected');

    act(() => {
      source.emit('canvas.sync', {
        cursor: 8,
        branches: [],
        interactions: [],
        sendOperations: [],
        removed: { branchIds: [], interactionIds: [], sendOperationIds: [] },
      });
      source.emit('node.preview', { interactionId: 'interaction-1', text: 'partial' });
    });
    expect(onSync).toHaveBeenCalledWith(expect.objectContaining({ cursor: 8 }));
    expect(onPreview).toHaveBeenCalledWith('interaction-1', 'partial');

    unmount();
    expect(source.close).toHaveBeenCalledOnce();
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it('drops previews when the stream reconnects', () => {
    const onDisconnect = vi.fn();
    const { result } = renderHook(() => useCanvasSync({
      canvasId: 'canvas-1',
      cursor: 0,
      onSync: vi.fn(),
      onPreview: vi.fn(),
      onDisconnect,
    }));
    act(() => FakeEventSource.instances[0].onerror?.());
    expect(result.current).toBe('reconnecting');
    expect(onDisconnect).toHaveBeenCalledOnce();
  });
});
