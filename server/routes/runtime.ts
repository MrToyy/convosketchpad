import { Hono } from 'hono';
import { getCanvasIdentity } from '../lib/canvas-auth.js';
import { getGatewayRuntimeStatus } from '../lib/gateway-rpc.js';
import { subscribeRuntimeEvents } from '../lib/runtime-events.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();
const encoder = new TextEncoder();

function sseFrame(event: string, data: unknown, id?: string): Uint8Array {
  return encoder.encode(`${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

app.get('/api/runtime/status', rateLimitGeneral, (c) => {
  const identity = getCanvasIdentity(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);
  return c.json(getGatewayRuntimeStatus());
});

app.get('/api/runtime/events', (c) => {
  const identity = getCanvasIdentity(c);
  if (!identity) return c.json({ error: 'Authentication required' }, 401);

  let unsubscribe: () => void = () => undefined;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        try { controller.close(); } catch { /* stream already closed */ }
      };
      try {
        controller.enqueue(sseFrame('runtime.connection_changed', getGatewayRuntimeStatus()));
      } catch {
        close();
        return;
      }
      unsubscribe = subscribeRuntimeEvents((event) => {
        if (event.type !== 'runtime.connection_changed') return;
        if (event.ownerId && event.ownerId !== identity.userId) return;
        try {
          controller.enqueue(sseFrame(event.type, event, event.id));
        } catch {
          close();
        }
      });
      heartbeat = setInterval(() => {
        if (!getCanvasIdentity(c)) {
          close();
          return;
        }
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          close();
        }
      }, 15_000);
    },
    cancel() {
      closed = true;
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

export default app;
