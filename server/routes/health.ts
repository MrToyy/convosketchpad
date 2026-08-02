/** Process health plus non-sensitive Agent Backend aggregate state. */
import { Hono } from 'hono';
import { agentBackendRegistry } from '../lib/agent-backends/registry.js';
import { aggregateBackendStatuses } from '../lib/agent-backends/catalog.js';

const app = new Hono();

app.get('/health', (c) => {
  const aggregate = aggregateBackendStatuses(
    agentBackendRegistry.list().map((backend) => backend.getStatus()),
  );
  return c.json({
    status: 'ok',
    uptime: process.uptime(),
    agentBackends: {
      overallState: aggregate.overallState,
      backends: aggregate.backends.map(({ backendId, state }) => ({ backendId, state })),
    },
  });
});

export default app;
