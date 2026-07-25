/**
 * GET /api/tokens — Gateway-native all-time token and cost statistics.
 *
 * OpenClaw remains the source of truth. ConvoSketchpad does not scan session
 * transcripts or maintain a local high-water usage file.
 */

import { Hono } from 'hono';
import {
  gatewayRpcCall,
  gatewaySupports,
} from '../lib/gateway-rpc.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();
const BREAKDOWN_REFRESH_INTERVAL_MS = 5 * 60_000;
const BREAKDOWN_TIMEOUT_MS = 120_000;

interface UsageBreakdown {
  totalMessages: number;
  totalErrors: number;
  entries: Array<{
    source: string;
    cost: number;
    messageCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  }>;
}

let cachedBreakdown: UsageBreakdown | null = null;
let breakdownRefresh: Promise<void> | null = null;
let lastBreakdownAttemptAt = 0;

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseUsageBreakdown(sessions: unknown): UsageBreakdown {
  const sessionRecord = record(sessions);
  const aggregates = record(sessionRecord.aggregates);
  const messages = record(aggregates.messages);
  const providers = Array.isArray(aggregates.byProvider) ? aggregates.byProvider : [];
  const entries = providers.flatMap((value) => {
    const provider = record(value);
    const providerName = typeof provider.provider === 'string'
      ? provider.provider
      : typeof provider.name === 'string'
        ? provider.name
        : '';
    if (!providerName) return [];
    const providerTotals = record(provider.totals);
    return [{
      source: providerName,
      cost: number(providerTotals.totalCost ?? providerTotals.cost),
      messageCount: number(providerTotals.messages ?? provider.messageCount ?? provider.count),
      inputTokens: number(providerTotals.input),
      outputTokens: number(providerTotals.output),
      cacheReadTokens: number(providerTotals.cacheRead),
    }];
  }).sort((a, b) => b.cost - a.cost);

  return {
    totalMessages: number(messages.total),
    totalErrors: number(messages.errors),
    entries,
  };
}

function refreshUsageBreakdown(): void {
  if (!gatewaySupports('sessions.usage')) return;
  if (breakdownRefresh || Date.now() - lastBreakdownAttemptAt < BREAKDOWN_REFRESH_INTERVAL_MS) return;

  lastBreakdownAttemptAt = Date.now();
  breakdownRefresh = gatewayRpcCall('sessions.usage', {
    agentScope: 'all',
    range: 'all',
    mode: 'gateway',
    groupBy: 'family',
    limit: 100_000,
  }, BREAKDOWN_TIMEOUT_MS)
    .then((sessions) => {
      cachedBreakdown = parseUsageBreakdown(sessions);
    })
    .catch(() => {
      // Provider/message details are optional. Keep serving core usage totals.
    })
    .finally(() => {
      breakdownRefresh = null;
    });
}

app.get('/api/tokens', rateLimitGeneral, async (c) => {
  try {
    const cost = await gatewayRpcCall('usage.cost', {
      agentScope: 'all',
      range: 'all',
      mode: 'gateway',
    }, 60_000);
    refreshUsageBreakdown();

    const costRecord = record(cost);
    const totals = record(costRecord.totals);
    const breakdown = cachedBreakdown;

    return c.json({
      totalCost: number(totals.totalCost ?? totals.cost),
      totalInput: number(totals.input),
      totalOutput: number(totals.output),
      totalCacheRead: number(totals.cacheRead),
      totalMessages: breakdown?.totalMessages ?? 0,
      totalErrors: breakdown?.totalErrors ?? 0,
      entries: breakdown?.entries ?? [],
      breakdownAvailable: breakdown !== null,
      updatedAt: number(costRecord.updatedAt) || Date.now(),
      source: 'openclaw-gateway',
    });
  } catch (error) {
    return c.json({
      error: 'gateway_usage_unavailable',
      detail: error instanceof Error ? error.message : 'OpenClaw usage RPC failed',
    }, 503);
  }
});

export const _internals = {
  getBreakdownRefresh: () => breakdownRefresh,
  resetBreakdownCache: () => {
    cachedBreakdown = null;
    breakdownRefresh = null;
    lastBreakdownAttemptAt = 0;
  },
};

export default app;
