import type { SessionPayload } from './session.js';
import { getCanvasStore, type CanvasStore, type CanvasUserRecord } from './canvas-db.js';
import { verifyPassword } from './session.js';

export interface ManagedIdentity {
  userId: string;
  name: string;
  tokenVersion: number;
}

export function isManagedIdentityActive(
  identity: ManagedIdentity,
  store: CanvasStore = getCanvasStore(),
): boolean {
  const account = store.getManagedUserById(identity.userId);
  return !!account && account.status === 'active' && account.tokenVersion === identity.tokenVersion;
}

export async function authenticateManagedToken(
  token: string,
  store: CanvasStore = getCanvasStore(),
): Promise<ManagedIdentity | null> {
  const accounts = store.listUsersWithCredentials();
  let matched: CanvasUserRecord | null = null;
  // Always check every stored credential so the response time does not reveal
  // which account matched. This mode is deliberately limited to a few users.
  for (const account of accounts) {
    if (account.tokenHash && await verifyPassword(token, account.tokenHash)) matched = account;
  }
  if (!matched || matched.status !== 'active') return null;
  return { userId: matched.id, name: matched.displayName, tokenVersion: matched.tokenVersion };
}

export function resolveManagedSession(
  session: SessionPayload | null,
  store: CanvasStore = getCanvasStore(),
): ManagedIdentity | null {
  if (!session?.sub || typeof session.ver !== 'number' || !Number.isInteger(session.ver)) return null;
  const account = store.getManagedUserById(session.sub);
  if (!account) return null;
  const identity = { userId: account.id, name: account.displayName, tokenVersion: session.ver };
  if (!isManagedIdentityActive(identity, store)) return null;
  return identity;
}
