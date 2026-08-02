import { describe, expect, it, vi } from 'vitest';
import { backendHandle } from './agent-backends/contract.js';
import {
  captureInteractionCompletionSession,
  captureInteractionContextSnapshot,
} from './canvas-context-snapshot.js';

const SESSION_KEY = 'agent:main:canvas:branch-1';
const SESSION_ID = 'session-1';
const conversationRef = backendHandle('openclaw', { sessionKey: SESSION_KEY });

function inspector(input: {
  exists?: boolean;
  instanceId?: string;
  context?: { usedTokens: number; contextLimit: number; model?: string; provider?: string; compactionCount?: number };
}) {
  return {
    inspectConversation: vi.fn(async () => ({
      exists: input.exists !== false,
      conversationRef,
      ...(input.instanceId ? { instanceId: input.instanceId } : {}),
      ...(input.context ? { context: input.context } : {}),
    })),
  };
}

describe('Interaction context snapshots', () => {
  it('captures a fresh exact-conversation snapshot through the Backend', async () => {
    const backend = inspector({
      instanceId: SESSION_ID,
      context: {
        usedTokens: 12_345,
        contextLimit: 100_000,
        provider: 'openai',
        model: 'gpt',
        compactionCount: 2,
      },
    });
    const result = await captureInteractionContextSnapshot(conversationRef, SESSION_ID, backend, 123);

    expect(backend.inspectConversation).toHaveBeenCalledWith(conversationRef);
    expect(result).toMatchObject({
      usedTokens: 12_345,
      contextLimit: 100_000,
      conversationInstanceId: SESSION_ID,
      provider: 'openai',
      model: 'gpt',
      compactionCount: 2,
      capturedAt: 123,
      source: 'agent-backend',
      backendId: 'openclaw',
    });
  });

  it('rejects a missing or different physical Conversation instance', async () => {
    await expect(captureInteractionContextSnapshot(
      conversationRef,
      SESSION_ID,
      inspector({ exists: false }),
    )).resolves.toBeNull();
    await expect(captureInteractionContextSnapshot(
      conversationRef,
      SESSION_ID,
      inspector({ instanceId: 'session-2', context: { usedTokens: 1, contextLimit: 10 } }),
    )).resolves.toBeNull();
  });

  it('retains exact Conversation identity when context usage is unavailable', async () => {
    await expect(captureInteractionCompletionSession(
      conversationRef,
      SESSION_ID,
      inspector({ instanceId: SESSION_ID }),
    )).resolves.toEqual({ conversationInstanceId: SESSION_ID, contextSnapshot: null });
  });

  it('accepts an exact physical instance when no prior instance was observed', async () => {
    const result = await captureInteractionContextSnapshot(
      conversationRef,
      undefined,
      inspector({ instanceId: SESSION_ID, context: { usedTokens: 100, contextLimit: 1_000 } }),
    );
    expect(result).toMatchObject({ conversationInstanceId: SESSION_ID, usedTokens: 100 });
  });
});
