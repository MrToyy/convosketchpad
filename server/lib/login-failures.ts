export interface LoginFailurePolicy {
  maxFailures: number;
  windowMs: number;
  lockoutMs: number;
  maxEntries?: number;
}

interface FailureEntry {
  failures: number[];
  lockedUntil: number;
  touchedAt: number;
}

export interface LoginLockout {
  locked: boolean;
  retryAfterSeconds: number;
  remainingAttempts: number;
}

export class LoginFailureTracker {
  private readonly entries = new Map<string, FailureEntry>();
  private readonly policy: LoginFailurePolicy;

  constructor(policy: LoginFailurePolicy) { this.policy = policy; }

  check(clientId: string, now = Date.now()): LoginLockout {
    const entry = this.entries.get(clientId);
    if (!entry) return { locked: false, retryAfterSeconds: 0, remainingAttempts: this.policy.maxFailures };
    if (entry.lockedUntil > now) {
      entry.touchedAt = now;
      return {
        locked: true,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)),
        remainingAttempts: 0,
      };
    }
    if (entry.lockedUntil > 0) {
      this.entries.delete(clientId);
      return { locked: false, retryAfterSeconds: 0, remainingAttempts: this.policy.maxFailures };
    }
    entry.failures = entry.failures.filter((timestamp) => timestamp > now - this.policy.windowMs);
    entry.touchedAt = now;
    if (entry.failures.length === 0) this.entries.delete(clientId);
    return {
      locked: false,
      retryAfterSeconds: 0,
      remainingAttempts: Math.max(0, this.policy.maxFailures - entry.failures.length),
    };
  }

  recordFailure(clientId: string, now = Date.now()): LoginLockout {
    this.evictExpired(now);
    let entry = this.entries.get(clientId);
    if (!entry) {
      const maxEntries = this.policy.maxEntries ?? 10_000;
      if (this.entries.size >= maxEntries) {
        const oldest = [...this.entries.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0]?.[0];
        if (oldest) this.entries.delete(oldest);
      }
      entry = { failures: [], lockedUntil: 0, touchedAt: now };
      this.entries.set(clientId, entry);
    }
    if (entry.lockedUntil > now) return this.check(clientId, now);
    entry.failures = entry.failures.filter((timestamp) => timestamp > now - this.policy.windowMs);
    entry.failures.push(now);
    entry.touchedAt = now;
    if (entry.failures.length >= this.policy.maxFailures) {
      entry.lockedUntil = now + this.policy.lockoutMs;
      return this.check(clientId, now);
    }
    return {
      locked: false,
      retryAfterSeconds: 0,
      remainingAttempts: this.policy.maxFailures - entry.failures.length,
    };
  }

  recordSuccess(clientId: string): void {
    this.entries.delete(clientId);
  }

  evictExpired(now = Date.now()): void {
    for (const [clientId, entry] of this.entries) {
      const staleFailure = entry.lockedUntil === 0 && entry.failures.every((timestamp) => timestamp <= now - this.policy.windowMs);
      const expiredLock = entry.lockedUntil > 0 && entry.lockedUntil <= now;
      if (staleFailure || expiredLock) this.entries.delete(clientId);
    }
  }

  get size(): number { return this.entries.size; }
}
