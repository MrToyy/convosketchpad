import { CanvasApiError } from './api';

export const GRAPH_EVENT_REFRESH_DELAY_MS = 300;

export function graphNeedsFallbackPolling(
  eventStreamState: string,
  hasPendingUpdates: boolean,
): boolean {
  return eventStreamState !== 'connected' && hasPendingUpdates;
}

export interface GraphRefreshController {
  run: () => Promise<void>;
  schedule: (delayMs?: number) => void;
  dispose: () => void;
}

/**
 * Coalesces fallback refresh requests, keeps only one Graph request in flight, and applies
 * Retry-After backoff without allowing timer callbacks to create unhandled
 * promise rejections.
 */
export function createGraphRefreshController(
  load: () => Promise<void>,
  onError: (error: unknown) => void,
): GraphRefreshController {
  let disposed = false;
  let inFlight: Promise<void> | null = null;
  let trailing = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (delayMs = GRAPH_EVENT_REFRESH_DELAY_MS) => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run().catch(onError);
    }, Math.max(0, delayMs));
  };

  async function run(): Promise<void> {
    if (disposed) return;
    if (inFlight) {
      trailing = true;
      return inFlight;
    }
    let retryDelayMs: number | null = null;
    const request = (async () => {
      try {
        await load();
      } catch (error) {
        if (error instanceof CanvasApiError && error.status === 429) {
          retryDelayMs = error.retryAfterMs ?? 1_000;
          return;
        }
        throw error;
      }
    })();
    inFlight = request;
    try {
      await request;
    } finally {
      if (inFlight === request) inFlight = null;
      if (retryDelayMs !== null && !disposed) {
        trailing = false;
        schedule(retryDelayMs);
      } else if (trailing && !disposed) {
        trailing = false;
        schedule(0);
      }
    }
  }

  return {
    run,
    schedule,
    dispose() {
      disposed = true;
      trailing = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
