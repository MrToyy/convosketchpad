/** Process health plus non-sensitive Agent Runtime aggregate state. */
import { Hono } from 'hono';
import { agentRuntimeRegistry } from '../lib/agent-runtimes/registry.js';
import { aggregateRuntimeStatuses } from '../lib/agent-runtimes/catalog.js';

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

export default app;
