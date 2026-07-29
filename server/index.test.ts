import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const pendingMediaMigration = new Promise<never>(() => undefined);
  return {
    events: [] as string[],
    pendingMediaMigration,
    runCanvasMediaBackfillMigration: vi.fn(() => pendingMediaMigration),
  };
});

vi.mock('@hono/node-server', () => ({
  serve: vi.fn((
    _options: unknown,
    onListen: (info: { address: string; family: string; port: number }) => void,
  ) => {
    mocks.events.push('http_listening');
    onListen({ address: '127.0.0.1', family: 'IPv4', port: 3080 });
    return {
      on: vi.fn(),
      close: vi.fn(),
    };
  }),
}));
vi.mock('./app.js', () => ({ default: { fetch: vi.fn() } }));
vi.mock('./lib/config.js', () => ({
  config: { host: '127.0.0.1', port: 3080 },
  validateConfig: vi.fn(() => mocks.events.push('config_validated')),
  printStartupBanner: vi.fn(),
  probeGateway: vi.fn(),
}));
vi.mock('./lib/canvas-reconciler.js', () => ({
  startCanvasReconciler: vi.fn(),
  stopCanvasReconciler: vi.fn(),
}));
vi.mock('./lib/gateway-rpc.js', () => ({ closeGatewayRpc: vi.fn() }));
vi.mock('./lib/canvas-send-coordinator.js', () => ({
  startCanvasSendCoordinator: vi.fn(),
  stopCanvasSendCoordinator: vi.fn(),
}));
vi.mock('./lib/canvas-db.js', () => ({
  getCanvasStore: vi.fn(() => {
    mocks.events.push('database_ready');
    return {};
  }),
}));
vi.mock('./lib/canvas-media-derivatives.js', () => ({
  runCanvasMediaBackfillMigration: (...args: unknown[]) => {
    mocks.events.push('media_backfill_started');
    return mocks.runCanvasMediaBackfillMigration(...args);
  },
}));
vi.mock('./lib/package-metadata.js', () => ({
  packageMetadata: { version: '0.3.0', description: 'Test' },
}));

describe('server startup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listens before starting the non-blocking historical media backfill', async () => {
    vi.spyOn(process, 'on').mockImplementation(() => process);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await import('./index.js');

    expect(mocks.events).toEqual([
      'config_validated',
      'database_ready',
      'http_listening',
      'media_backfill_started',
    ]);
    expect(mocks.runCanvasMediaBackfillMigration).toHaveBeenCalledOnce();
  });
});
