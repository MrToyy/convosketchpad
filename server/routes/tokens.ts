/**
 * GET /api/runtime/usage — per-Backend account usage and quota statistics.
 *
 * The selected Agent Backend remains the source of truth. ConvoSketchpad does
 * not scan transcripts or maintain a local high-water usage file.
 */

import { Hono } from 'hono';
import { agentBackendRegistry } from '../lib/agent-backends/registry.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();

app.get('/api/runtime/usage', rateLimitGeneral, async (c) => {
  const entries = await Promise.all(agentBackendRegistry.list().map(async (backend) => {
    const status = backend.getStatus();
    let displayName = backend.id;
    try { displayName = (await backend.describe()).displayName; } catch { /* keep stable id */ }
    if (status.state !== 'connected') {
      return {
        backendId: backend.id,
        displayName,
        available: false,
        usageSupported: status.capabilities?.usage.accountUsage ?? null,
        error: status.error || 'Backend unavailable',
      };
    }
    const capabilities = status.capabilities;
    if (!capabilities) {
      return {
        backendId: backend.id,
        displayName,
        available: true,
        usageSupported: null,
        error: 'Backend capabilities are not available yet',
      };
    }
    const [usage, quotas] = await Promise.all([
      capabilities.usage.accountUsage
        ? backend.readUsageSummary().then((value) => ({ value })).catch((error) => ({ error }))
        : Promise.resolve(null),
      capabilities.usage.accountQuota
        ? backend.readProviderQuotas().then((value) => ({ value })).catch((error) => ({ error }))
        : Promise.resolve(null),
    ]);
    const errors = [usage && 'error' in usage ? usage.error : null, quotas && 'error' in quotas ? quotas.error : null]
      .filter(Boolean)
      .map((error) => error instanceof Error ? error.message : String(error));
    return {
      backendId: backend.id,
      displayName,
      available: true,
      usageSupported: capabilities.usage.accountUsage,
      ...(usage && 'value' in usage ? { usage: usage.value } : {}),
      ...(quotas && 'value' in quotas ? { quotas: quotas.value } : {}),
      ...(errors.length ? { error: errors.join('; ') } : {}),
    };
  }));
  const additive = entries.flatMap((entry) => entry.available && 'usage' in entry && entry.usage?.additive
    ? [entry.usage]
    : []);
  const usageBackends = entries.filter((entry) => entry.usageSupported !== false);
  const currencies = new Set(additive.map((usage) => usage.currency).filter(Boolean));
  const periods = new Set(additive.map((usage) => usage.period).filter(Boolean));
  const comparable = additive.length > 0
    && entries.every((entry) => entry.available)
    && additive.length === usageBackends.length
    && currencies.size === 1
    && periods.size === 1;
  return c.json({
    backends: entries,
    ...(comparable ? {
      comparableCostTotal: {
        currency: [...currencies][0],
        amount: additive.reduce((sum, usage) => sum + usage.totalCost, 0),
      },
    } : {}),
    updatedAt: Date.now(),
  });
});

export default app;
