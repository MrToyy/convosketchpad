import { randomBytes } from 'node:crypto';
import { CanvasStore, getCanvasStore } from './canvas/persistence/canvas-store.js';
import type { CanvasUserRecord } from './canvas/model.js';
import { hashManagedToken, verifyManagedTokenHash } from './session.js';

const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_TOKEN_LENGTH = 256;

export interface CreatedManagedUser {
  user: CanvasUserRecord;
  token: string;
  claimedCanvasCount: number;
}

export function normalizeDisplayName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error('user_name_required');
  if (name.length > MAX_DISPLAY_NAME_LENGTH) throw new Error('user_name_too_long');
  return name;
}

export function normalizeManagedToken(value: string): string {
  const token = value.trim();
  if (!token) throw new Error('token_required');
  if (token.length > MAX_TOKEN_LENGTH) throw new Error('token_too_long');
  return token;
}

export function generateManagedToken(): string {
  return randomBytes(24).toString('base64url');
}

async function assertUniqueToken(token: string, store: CanvasStore, exceptUserId?: string): Promise<void> {
  for (const account of store.listUsersWithCredentials()) {
    if (account.id !== exceptUserId && account.tokenHash && await verifyManagedTokenHash(token, account.tokenHash)) {
      throw new Error('token_exists');
    }
  }
}

export async function createManagedUser(
  displayName: string,
  requestedToken?: string,
  store: CanvasStore = getCanvasStore(),
): Promise<CreatedManagedUser> {
  const name = normalizeDisplayName(displayName);
  const token = normalizeManagedToken(requestedToken ?? generateManagedToken());
  await assertUniqueToken(token, store);
  const tokenHash = await hashManagedToken(token);
  const result = store.createManagedUser(name, tokenHash);
  return { ...result, token };
}

export async function rotateManagedToken(
  displayName: string,
  requestedToken?: string,
  store: CanvasStore = getCanvasStore(),
): Promise<{ user: CanvasUserRecord; token: string }> {
  const name = normalizeDisplayName(displayName);
  const token = normalizeManagedToken(requestedToken ?? generateManagedToken());
  const existing = store.getManagedUserByName(name);
  if (!existing) throw new Error('user_not_found');
  await assertUniqueToken(token, store, existing.id);
  const tokenHash = await hashManagedToken(token);
  return { user: store.rotateManagedUserToken(name, tokenHash), token };
}
