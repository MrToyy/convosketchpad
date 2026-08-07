import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { config, SESSION_COOKIE_NAME } from './config.js';
import { resolveManagedSession } from './managed-users.js';
import { verifySession } from './session.js';

export interface CanvasIdentity {
  userId: string;
  name: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    canvasIdentity: CanvasIdentity;
  }
}

export function getCanvasIdentity(c: Context): CanvasIdentity | null {
  const verified = c.get('canvasIdentity');
  if (verified) return verified;
  if (!config.auth) {
    return { userId: 'local', name: 'Local User' };
  }
  const cookie = getCookie(c, SESSION_COOKIE_NAME);
  const session = cookie ? verifySession(cookie, config.sessionSecret) : null;
  const identity = resolveManagedSession(session);
  return identity ? { userId: identity.userId, name: identity.name } : null;
}
