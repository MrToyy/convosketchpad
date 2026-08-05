import type { AgentRuntime, RuntimeHandle } from './agent-runtimes/contract.js';
import type { InteractionContextSnapshot } from './canvas/model.js';

export interface InteractionCompletionConversation {
  conversationInstanceId: string;
  contextSnapshot: InteractionContextSnapshot | null;
}

export async function captureInteractionCompletionSession(
  conversationRef: RuntimeHandle,
  expectedInstanceId?: string,
  runtime?: Pick<AgentRuntime, 'inspectConversation'>,
  capturedAt = Date.now(),
): Promise<InteractionCompletionConversation | null> {
  if (!runtime) throw new Error('Agent Runtime is required to capture a conversation snapshot');
  const snapshot = await runtime.inspectConversation(conversationRef);
  if (!snapshot?.exists || !snapshot.instanceId) return null;
  if (expectedInstanceId !== undefined && snapshot.instanceId !== expectedInstanceId) return null;
  return {
    conversationInstanceId: snapshot.instanceId,
    contextSnapshot: snapshot.context ? {
      usedTokens: snapshot.context.usedTokens,
      contextLimit: snapshot.context.contextLimit,
      conversationInstanceId: snapshot.instanceId,
      ...(snapshot.context.model ? { model: snapshot.context.model } : {}),
      ...(snapshot.context.provider ? { provider: snapshot.context.provider } : {}),
      ...(snapshot.context.compactionCount === undefined
        ? {}
        : { compactionCount: snapshot.context.compactionCount }),
      capturedAt,
      source: 'agent-runtime',
      runtimeId: conversationRef.runtimeId,
      conversationRef,
    } : null,
  };
}

export async function captureInteractionContextSnapshot(
  conversationRef: RuntimeHandle,
  expectedInstanceId?: string,
  runtime?: Pick<AgentRuntime, 'inspectConversation'>,
  capturedAt = Date.now(),
): Promise<InteractionContextSnapshot | null> {
  return (await captureInteractionCompletionSession(
    conversationRef,
    expectedInstanceId,
    runtime,
    capturedAt,
  ))?.contextSnapshot || null;
}
