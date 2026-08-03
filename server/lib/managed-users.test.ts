import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CanvasStore } from './canvas-db.js';
import { authenticateManagedToken, resolveManagedSession } from './managed-users.js';
import { createManagedUser, rotateManagedToken } from './user-management.js';

const stores: CanvasStore[] = [];
const dirs: string[] = [];

function createStore(): CanvasStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'convosketchpad-users-'));
  dirs.push(dir);
  const store = new CanvasStore(path.join(dir, 'canvas.sqlite'));
  stores.push(store);
  return store;
}

afterEach(() => {
  while (stores.length) stores.pop()?.close();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('managed users', () => {
  it('creates only CLI-managed credentials and authenticates the exact token', async () => {
    const store = createStore();
    const created = await createManagedUser('Alice', 'SimpleToken', store);
    expect(created.user.displayName).toBe('Alice');
    expect(created.user.tokenHash).not.toBe('SimpleToken');
    expect(await authenticateManagedToken('SimpleToken', store)).toMatchObject({ userId: created.user.id, name: 'Alice', tokenVersion: 1 });
    expect(await authenticateManagedToken('simpletoken', store)).toBeNull();
  });

  it('rejects duplicate names case-insensitively', async () => {
    const store = createStore();
    await createManagedUser('Alice', 'one', store);
    await expect(createManagedUser('alice', 'two', store)).rejects.toThrow('user_exists');
  });

  it('rejects assigning the same token to two users', async () => {
    const store = createStore();
    await createManagedUser('One', 'shared', store);
    await expect(createManagedUser('Two', 'shared', store)).rejects.toThrow('token_exists');
  });

  it('moves Local User canvases to the first managed account only', async () => {
    const store = createStore();
    store.ensureUser('local', 'Local User');
    store.createCanvas('local', 'Existing Canvas', { runtimeId: 'openclaw', profileId: 'main' });
    const first = await createManagedUser('First', 'one', store);
    const second = await createManagedUser('Second', 'two', store);
    expect(first.claimedCanvasCount).toBe(1);
    expect(second.claimedCanvasCount).toBe(0);
    expect(store.listCanvases(first.user.id).map((canvas) => canvas.name)).toEqual(['Existing Canvas']);
  });

  it('rotates tokens without changing owner id and revokes the prior session version', async () => {
    const store = createStore();
    const created = await createManagedUser('User', 'old-token', store);
    const oldSession = { exp: Date.now() + 60_000, iat: Date.now(), sub: created.user.id, name: 'User', ver: 1 };
    const rotated = await rotateManagedToken('User', 'new-token', store);
    expect(rotated.user.id).toBe(created.user.id);
    expect(rotated.user.tokenVersion).toBe(2);
    expect(await authenticateManagedToken('old-token', store)).toBeNull();
    expect(await authenticateManagedToken('new-token', store)).toMatchObject({ userId: created.user.id, tokenVersion: 2 });
    expect(resolveManagedSession(oldSession, store)).toBeNull();
  });

  it('disables and enables an account while preserving its data', async () => {
    const store = createStore();
    const created = await createManagedUser('User', 'token', store);
    store.createCanvas(created.user.id, 'Kept', { runtimeId: 'openclaw', profileId: 'main' });
    const disabled = store.setManagedUserStatus('User', 'disabled');
    expect(disabled.tokenVersion).toBe(2);
    expect(await authenticateManagedToken('token', store)).toBeNull();
    const enabled = store.setManagedUserStatus('User', 'active');
    expect(enabled.tokenVersion).toBe(3);
    expect(store.listCanvases(enabled.id)).toHaveLength(1);
  });
});
