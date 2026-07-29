const RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000];
const STEADY_RETRY_DELAY_MS = 60_000;
const ACTIVE_DISPATCH_RECHECK_MS = 250;

export function canvasSendRetryDelay(attemptCount: number): number {
  return RETRY_DELAYS_MS[Math.max(0, attemptCount - 1)] || STEADY_RETRY_DELAY_MS;
}

export function canvasSendRetryWakeAt(
  nextAttemptAt: number | null,
  now: number,
  hasActiveDispatch: boolean,
): number | null {
  if (nextAttemptAt === null) return null;
  if (nextAttemptAt <= now && hasActiveDispatch) return now + ACTIVE_DISPATCH_RECHECK_MS;
  return Math.max(now, nextAttemptAt);
}
