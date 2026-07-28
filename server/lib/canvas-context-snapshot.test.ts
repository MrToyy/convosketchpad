import { describe, expect, it, vi } from 'vitest';
import { captureInteractionContextSnapshot } from './canvas-context-snapshot.js';

const SESSION_KEY = 'agent:main:canvas:branch-1';
const SESSION_ID = 'session-1';

describe('Interaction context snapshots', () => {
  it('captures a fresh exact-session snapshot through sessions.describe', async () => {
    const call = vi.fn(async () => ({
      session: {
        key: SESSION_KEY,
        sessionId: SESSION_ID,
        totalTokens: 12_345,
        totalTokensFresh: true,
        contextTokens: 100_000,
        modelProvider: 'openai',
        model: 'gpt',
        compactionCount: 2,
      },
    }));
    const result = await captureInteractionContextSnapshot(SESSION_KEY, SESSION_ID, {
      call,
      supports: vi.fn(() => true),
    }, 123);

    expect(call).toHaveBeenCalledWith('sessions.describe', { key: SESSION_KEY }, 3_000);
    expect(result).toEqual({
      usedTokens: 12_345,
      contextLimit: 100_000,
      sessionKey: SESSION_KEY,
      sessionId: SESSION_ID,
      provider: 'openai',
      model: 'gpt',
      compactionCount: 2,
      capturedAt: 123,
      source: 'openclaw-session',
    });
  });

  it('rejects a stale snapshot or a different physical session', async () => {
    const stale = await captureInteractionContextSnapshot(SESSION_KEY, SESSION_ID, {
      call: vi.fn(async () => ({
        session: {
          key: SESSION_KEY,
          sessionId: SESSION_ID,
          totalTokens: 100,
          totalTokensFresh: false,
          contextTokens: 1_000,
        },
      })),
      supports: vi.fn(() => true),
    });
    const drifted = await captureInteractionContextSnapshot(SESSION_KEY, SESSION_ID, {
      call: vi.fn(async () => ({
        session: {
          key: SESSION_KEY,
          sessionId: 'session-2',
          totalTokens: 100,
          totalTokensFresh: true,
          contextTokens: 1_000,
        },
      })),
      supports: vi.fn(() => true),
    });

    expect(stale).toBeNull();
    expect(drifted).toBeNull();
  });

  it('accepts the exact-key physical session when no prior Session ID was observable', async () => {
    const result = await captureInteractionContextSnapshot(SESSION_KEY, undefined, {
      call: vi.fn(async () => ({
        session: {
          key: SESSION_KEY,
          sessionId: SESSION_ID,
          totalTokens: 100,
          totalTokensFresh: true,
          contextTokens: 1_000,
        },
      })),
      supports: vi.fn(() => true),
    });

    expect(result).toMatchObject({
      sessionKey: SESSION_KEY,
      sessionId: SESSION_ID,
      usedTokens: 100,
    });
  });

  it('falls back to a bounded exact-key search', async () => {
    const call = vi.fn(async () => ({
      sessions: [
        { key: `${SESSION_KEY}:other`, sessionId: SESSION_ID, totalTokens: 99, totalTokensFresh: true, contextTokens: 100 },
        { key: SESSION_KEY, sessionId: SESSION_ID, totalTokens: 25, totalTokensFresh: true, contextTokens: 200 },
      ],
    }));
    const result = await captureInteractionContextSnapshot(SESSION_KEY, SESSION_ID, {
      call,
      supports: vi.fn(() => false),
    });

    expect(call).toHaveBeenCalledWith('sessions.list', {
      search: SESSION_KEY,
      limit: 20,
    }, 3_000);
    expect(result).toMatchObject({ usedTokens: 25, contextLimit: 200 });
  });
});
