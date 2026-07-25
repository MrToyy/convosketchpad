/**
 * Generic TTL cache with in-flight request deduplication.
 *
 * Avoids redundant expensive fetches when multiple clients hit the same
 * endpoint concurrently. Failed fetches use a shorter TTL so retries happen
 * sooner.
 * @module
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface CacheSlot<T> {
  data: T | null;
  ts: number;
  ttl: number;
  inFlight: Promise<T> | null;
}

export function createCachedFetch<T>(
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
  opts?: { isValid?: (result: T) => boolean },
): () => Promise<T> {
  const slot: CacheSlot<T> = { data: null, ts: 0, ttl: ttlMs, inFlight: null };
  const failureTtlMs = 30_000;

  return async () => {
    const now = Date.now();
    if (slot.data !== null && now - slot.ts < slot.ttl) return slot.data;

    if (!slot.inFlight) {
      slot.inFlight = fetcher().then(
        (result) => {
          const valid = opts?.isValid ? opts.isValid(result) : true;
          slot.data = result;
          slot.ts = Date.now();
          slot.ttl = valid ? ttlMs : failureTtlMs;
          slot.inFlight = null;
          return result;
        },
        (error) => {
          slot.inFlight = null;
          throw error;
        },
      );
    }

    return slot.inFlight;
  };
}
