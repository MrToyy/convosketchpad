/** Generic lifecycle actions exposed by configured Agent Runtimes. */
import { Hono } from 'hono';
import { RuntimeOperationError } from '../lib/agent-runtimes/contract.js';
import type { AgentRuntimeRegistry } from '../lib/agent-runtimes/registry.js';
import { rateLimitRestart } from '../middleware/rate-limit.js';

export function createRuntimeActionRoutes(agentRuntimeRegistry: AgentRuntimeRegistry) {
  const app = new Hono();
  app.post('/api/runtime/:runtimeId/restart', rateLimitRestart, async (c) => {
    const runtimeId = c.req.param('runtimeId');
    if (!runtimeId || !agentRuntimeRegistry.has(runtimeId)) {
      return c.json({ ok: false, error: 'runtime_not_found' }, 404);
    }
    const runtime = agentRuntimeRegistry.get(runtimeId);
    if (!runtime.getStatus().restartSupported) {
      return c.json({ ok: false, error: 'runtime_restart_unsupported' }, 409);
    }
    try {
      const result = await runtime.restart();
      return c.json({ ok: true, output: result.output });
    } catch (error) {
      const unsupported = error instanceof RuntimeOperationError && error.kind === 'unsupported';
      return c.json({
        ok: false,
        error: unsupported ? 'runtime_restart_unsupported' : 'runtime_restart_failed',
        output: error instanceof Error ? error.message : 'Runtime restart failed',
      }, unsupported ? 409 : 500);
    }
  });

  return app;
}
