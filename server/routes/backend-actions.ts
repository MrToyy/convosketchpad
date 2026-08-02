/** Generic lifecycle actions exposed by configured Agent Backends. */
import { Hono } from 'hono';
import { BackendOperationError } from '../lib/agent-backends/contract.js';
import { agentBackendRegistry } from '../lib/agent-backends/registry.js';
import { rateLimitRestart } from '../middleware/rate-limit.js';

const app = new Hono();

app.post('/api/runtime/backends/:backendId/restart', rateLimitRestart, async (c) => {
  const backendId = c.req.param('backendId');
  if (!backendId || !agentBackendRegistry.has(backendId)) {
    return c.json({ ok: false, error: 'backend_not_found' }, 404);
  }
  const backend = agentBackendRegistry.get(backendId);
  if (!backend.getStatus().restartSupported) {
    return c.json({ ok: false, error: 'backend_restart_unsupported' }, 409);
  }
  try {
    const result = await backend.restart();
    return c.json({ ok: true, output: result.output });
  } catch (error) {
    const unsupported = error instanceof BackendOperationError && error.kind === 'unsupported';
    return c.json({
      ok: false,
      error: unsupported ? 'backend_restart_unsupported' : 'backend_restart_failed',
      output: error instanceof Error ? error.message : 'Backend restart failed',
    }, unsupported ? 409 : 500);
  }
});

export default app;
