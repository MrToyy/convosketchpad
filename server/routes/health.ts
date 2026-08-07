/** Process health plus non-sensitive Agent Runtime aggregate state. */
import { Hono } from 'hono';
import type { AgentRuntimeRegistry } from '../lib/agent-runtimes/registry.js';
import { aggregateRuntimeStatuses } from '../lib/agent-runtimes/catalog.js';

export function createHealthRoutes(agentRuntimeRegistry: AgentRuntimeRegistry) {
  const app = new Hono();
  app.get('/health', (c) => {
    const aggregate = aggregateRuntimeStatuses(
      agentRuntimeRegistry.list().map((runtime) => runtime.getStatus()),
    );
    return c.json({
      status: 'ok',
      uptime: process.uptime(),
      agentRuntimes: {
        overallState: aggregate.overallState,
        runtimes: aggregate.runtimes.map(({ runtimeId, state }) => ({ runtimeId, state })),
      },
    });
  });

  return app;
}
