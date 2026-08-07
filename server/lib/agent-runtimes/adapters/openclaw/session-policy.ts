import { gatewayRpcCall } from './gateway-rpc.js';

export type OpenClawResetMode = 'daily' | 'idle';

export interface OpenClawResetPolicy {
  mode: OpenClawResetMode;
  atHour: number;
  idleMinutes: number | null;
}

interface CachedResetPolicy {
  expiresAt: number;
  policy: OpenClawResetPolicy | null;
}

const POLICY_CACHE_MS = 30_000;
const DEFAULT_RESET_HOUR = 4;
const SEND_GUARD_MS = 60_000;

let cachedPolicy: CachedResetPolicy | null = null;

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const resolveOpenClawResetPolicy = (
  rawSessionConfig: unknown,
): OpenClawResetPolicy => {
  const session = asObject(rawSessionConfig) ?? {};
  const resetByChannel = asObject(session.resetByChannel);
  const resetByType = asObject(session.resetByType);
  const channelReset = asObject(resetByChannel?.webchat);
  const baseReset = channelReset ?? asObject(session.reset);
  const typeReset = channelReset
    ? null
    : asObject(resetByType?.direct) ?? asObject(resetByType?.dm);
  const hasExplicitReset = Boolean(baseReset || resetByType);
  const legacyIdle = channelReset ? null : finiteNumber(session.idleMinutes);

  const configuredMode = typeReset?.mode ?? baseReset?.mode;
  const mode: OpenClawResetMode =
    configuredMode === 'idle' ||
    (!hasExplicitReset && legacyIdle !== null)
      ? 'idle'
      : 'daily';
  const configuredHour =
    finiteNumber(typeReset?.atHour) ?? finiteNumber(baseReset?.atHour);
  const atHour =
    configuredHour !== null
      ? Math.max(0, Math.min(23, Math.floor(configuredHour)))
      : DEFAULT_RESET_HOUR;

  const configuredIdle =
    finiteNumber(typeReset?.idleMinutes) ??
    finiteNumber(baseReset?.idleMinutes) ??
    legacyIdle;
  const normalizedIdle =
    configuredIdle === null ? null : Math.max(0, Math.floor(configuredIdle));
  const idleMinutes =
    normalizedIdle !== null && normalizedIdle > 0 ? normalizedIdle : null;

  return { mode, atHour, idleMinutes };
};

const timezoneOffsetMs = (instant: Date, timeZone: string): number => {
  const offset =
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(instant)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  if (offset === 'GMT' || offset === 'UTC') return 0;

  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) throw new Error(`Unable to resolve UTC offset for ${timeZone}`);
  const sign = match[1] === '+' ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
};

const zonedDateParts = (
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number } => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
  };
};

const zonedLocalInstant = (
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
): number => {
  const approximate = Date.UTC(year, month - 1, day, hour);
  const offsets = new Set([
    timezoneOffsetMs(new Date(approximate - 36 * 60 * 60_000), timeZone),
    timezoneOffsetMs(new Date(approximate - 24 * 60 * 60_000), timeZone),
    timezoneOffsetMs(new Date(approximate), timeZone),
    timezoneOffsetMs(new Date(approximate + 24 * 60 * 60_000), timeZone),
    timezoneOffsetMs(new Date(approximate + 36 * 60 * 60_000), timeZone),
  ]);
  const candidates = [...offsets]
    .map((offset) => approximate - offset)
    .filter((candidate) => {
      const local = zonedDateParts(new Date(candidate), timeZone);
      return (
        local.year === year &&
        local.month === month &&
        local.day === day &&
        local.hour === hour
      );
    });
  if (candidates.length > 0) {
    return Math.min(...candidates);
  }

  // Match JavaScript Date's "compatible" DST behavior: a nonexistent local
  // hour is shifted forward by the transition gap using the pre-transition
  // offset.
  const priorOffset = timezoneOffsetMs(
    new Date(approximate - 24 * 60 * 60_000),
    timeZone,
  );
  return approximate - priorOffset;
};

export const latestDailyResetBoundary = (
  now: number,
  atHour: number,
  timeZone: string,
): number => {
  const local = zonedDateParts(new Date(now), timeZone);
  const boundary = zonedLocalInstant(
    local.year,
    local.month,
    local.day,
    atHour,
    timeZone,
  );
  if (boundary <= now) return boundary;

  const previousDate = new Date(Date.UTC(local.year, local.month - 1, local.day - 1));
  return zonedLocalInstant(
    previousDate.getUTCFullYear(),
    previousDate.getUTCMonth() + 1,
    previousDate.getUTCDate(),
    atHour,
    timeZone,
  );
};

export const sessionWillResetBeforeSend = (input: {
  policy: OpenClawResetPolicy;
  sessionStartedAt: number | null;
  lastInteractionAt: number | null;
  now?: number;
  guardMs?: number;
  timeZone: string;
}): boolean => {
  if (input.sessionStartedAt === null) return true;

  const guardedNow = (input.now ?? Date.now()) + (input.guardMs ?? SEND_GUARD_MS);
  const dailyExpired =
    input.policy.mode === 'daily' &&
    input.sessionStartedAt <
      latestDailyResetBoundary(
        guardedNow,
        input.policy.atHour,
        input.timeZone,
      );
  const idleExpired =
    input.policy.idleMinutes !== null &&
    input.lastInteractionAt !== null &&
    input.lastInteractionAt + input.policy.idleMinutes * 60_000 < guardedNow;

  return dailyExpired || idleExpired;
};

export const getCanvasSessionResetPolicy = async (): Promise<{
  policy: OpenClawResetPolicy | null;
  available: boolean;
}> => {
  const now = Date.now();
  if (cachedPolicy && cachedPolicy.expiresAt > now) {
    return {
      policy: cachedPolicy.policy,
      available: cachedPolicy.policy !== null,
    };
  }

  try {
    const payload = await gatewayRpcCall(
      'config.get',
      {},
      10_000,
    );
    const root = asObject(payload);
    const rawConfig = asObject(root?.config);
    const policy = resolveOpenClawResetPolicy(rawConfig?.session);
    cachedPolicy = { policy, expiresAt: now + POLICY_CACHE_MS };
    return { policy, available: true };
  } catch (error) {
    console.warn(
      '[canvas] Unable to read OpenClaw session reset policy:',
      error instanceof Error ? error.message : error,
    );
    if (cachedPolicy?.policy) {
      cachedPolicy.expiresAt = now + POLICY_CACHE_MS;
      return { policy: cachedPolicy.policy, available: true };
    }
    cachedPolicy = { policy: null, expiresAt: now + POLICY_CACHE_MS };
    return { policy: null, available: false };
  }
};

export const resetSessionPolicyCacheForTests = (): void => {
  cachedPolicy = null;
};
