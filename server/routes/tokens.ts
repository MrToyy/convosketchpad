/**
 * GET /api/tokens — Gateway-native all-time token and cost statistics.
 *
 * OpenClaw remains the source of truth. ConvoSketchpad does not scan session
 * transcripts or maintain a local high-water usage file.
 */

import { Hono } from 'hono';
import { gatewayRpcCall } from '../lib/gateway-rpc.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

app.get('/api/tokens', rateLimitGeneral, async (c) => {
  try {
    const cost = await gatewayRpcCall('usage.cost', {
      agentScope: 'all',
      range: 'all',
      mode: 'gateway',
    }, 60_000);

    const costRecord = record(cost);
    const totals = record(costRecord.totals);

    return c.json({
      totalCost: number(totals.totalCost ?? totals.cost),
      totalInput: number(totals.input),
      totalOutput: number(totals.output),
      totalCacheRead: number(totals.cacheRead),
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

export default app;
