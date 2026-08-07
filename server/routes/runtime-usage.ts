/**
 * GET /api/runtime/usage — per-Runtime account usage and quota statistics.
 *
 * The selected Agent Runtime remains the source of truth. ConvoSketchpad does
 * not scan transcripts or maintain a local high-water usage file.
 */

import { Hono } from 'hono';
import type { AgentRuntimeRegistry } from '../lib/agent-runtimes/registry.js';
import { RuntimeUsageService } from '../lib/agent-runtimes/usage-service.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

export function createRuntimeUsageRoutes(agentRuntimeRegistry: AgentRuntimeRegistry) {
  const app = new Hono();
  app.get('/api/runtime/usage', rateLimitGeneral, async (c) => {
    return c.json(await new RuntimeUsageService(agentRuntimeRegistry).read());
  });

  return app;
}
