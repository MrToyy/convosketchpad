import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('SSE shutdown', () => {
  let unsubscribeCanvas: ReturnType<typeof vi.fn>;
  let unsubscribeRuntime: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    unsubscribeCanvas = vi.fn();
    unsubscribeRuntime = vi.fn();
    vi.doMock('../lib/canvas-auth.js', () => ({
      getCanvasIdentity: () => ({ userId: 'owner-a', name: 'Owner A' }),
    }));
    vi.doMock('../lib/canvas-sync.js', () => ({
      subscribeCanvasSync: vi.fn(() => unsubscribeCanvas),
    }));
    vi.doMock('../lib/runtime-status-events.js', () => ({
      subscribeRuntimeEvents: vi.fn(() => unsubscribeRuntime),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stops canvas catch-up reads before the database closes', async () => {
    const shutdown = new AbortController();
    const getCanvasSyncBatch = vi.fn(() => null);
    const { createCanvasRoutes } = await import('./canvas.js');
    const app = new Hono();
    app.route('/', createCanvasRoutes({
      store: {
        getCanvas: vi.fn(() => ({ id: 'canvas-a' })),
        getCanvasSyncBatch,
      } as never,
      runtimes: { get: vi.fn(), list: () => [] } as never,
      shutdownSignal: shutdown.signal,
    }));

    const response = await app.request('/api/canvas/canvases/canvas-a/events');
    expect(response.status).toBe(200);
    expect(getCanvasSyncBatch).toHaveBeenCalledOnce();

    shutdown.abort();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(getCanvasSyncBatch).toHaveBeenCalledOnce();
    expect(unsubscribeCanvas).toHaveBeenCalledOnce();
    await expect(response.body!.getReader().read()).resolves.toMatchObject({ done: true });
  });

  it('closes runtime event streams and heartbeats during shutdown', async () => {
    const shutdown = new AbortController();
    const { createRuntimeRoutes } = await import('./runtime.js');
    const app = new Hono();
    app.route('/', createRuntimeRoutes({ list: () => [] } as never, shutdown.signal));

    const response = await app.request('/api/runtime/events');
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();

    shutdown.abort();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(unsubscribeRuntime).toHaveBeenCalledOnce();
    expect((await reader.read()).done).toBe(false);
    expect((await reader.read()).done).toBe(true);
  });
});
