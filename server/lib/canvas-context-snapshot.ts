import type { AgentRuntime, RuntimeHandle } from './agent-runtimes/contract.js';
import type { InteractionContextSnapshot } from './canvas/model.js';

export interface InteractionCompletionConversation {
  conversationInstanceId: string;
  contextSnapshot: InteractionContextSnapshot | null;
}

function validContextUsage(value: { usedTokens: number; contextLimit: number }): boolean {
  return Number.isFinite(value.usedTokens)
    && value.usedTokens >= 0
    && Number.isFinite(value.contextLimit)
    && value.contextLimit > 0
    && value.usedTokens <= value.contextLimit;
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
  const context = snapshot.context && validContextUsage(snapshot.context)
    ? snapshot.context
    : null;
  return {
    conversationInstanceId: snapshot.instanceId,
    contextSnapshot: context ? {
      usedTokens: context.usedTokens,
      contextLimit: context.contextLimit,
      conversationInstanceId: snapshot.instanceId,
      ...(context.model ? { model: context.model } : {}),
      ...(context.provider ? { provider: context.provider } : {}),
      ...(context.compactionCount === undefined
        ? {}
        : { compactionCount: context.compactionCount }),
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
