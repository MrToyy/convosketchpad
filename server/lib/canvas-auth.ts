import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { config, SESSION_COOKIE_NAME } from './config.js';
import { getCanvasStore } from './canvas-db.js';
import { resolveManagedSession } from './managed-users.js';
import { verifySession } from './session.js';

export interface CanvasIdentity {
  userId: string;
  name: string;
}

export function getCanvasIdentity(c: Context): CanvasIdentity | null {
  if (!config.auth) {
    const identity = { userId: 'local', name: 'Local User' };
    getCanvasStore().ensureUser(identity.userId, identity.name);
    return identity;
  }
  const cookie = getCookie(c, SESSION_COOKIE_NAME);
  const session = cookie ? verifySession(cookie, config.sessionSecret) : null;
  const identity = resolveManagedSession(session);
  return identity ? { userId: identity.userId, name: identity.name } : null;
}
