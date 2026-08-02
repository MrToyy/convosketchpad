import type { AgentBackend, BackendHandle } from './agent-backends/contract.js';
import { getAgentBackend } from './agent-backends/registry.js';
import type { InteractionContextSnapshot } from './canvas-db.js';

export interface InteractionCompletionConversation {
  conversationInstanceId: string;
  contextSnapshot: InteractionContextSnapshot | null;
}

export async function captureInteractionCompletionSession(
  conversationRef: BackendHandle,
  expectedInstanceId?: string,
  backend: Pick<AgentBackend, 'inspectConversation'> = getAgentBackend(conversationRef.backendId),
  capturedAt = Date.now(),
): Promise<InteractionCompletionConversation | null> {
  const snapshot = await backend.inspectConversation(conversationRef);
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
      source: 'agent-backend',
      backendId: conversationRef.backendId,
      conversationRef,
    } : null,
  };
}

export async function captureInteractionContextSnapshot(
  conversationRef: BackendHandle,
  expectedInstanceId?: string,
  backend: Pick<AgentBackend, 'inspectConversation'> = getAgentBackend(conversationRef.backendId),
  capturedAt = Date.now(),
): Promise<InteractionContextSnapshot | null> {
  return (await captureInteractionCompletionSession(
    conversationRef,
    expectedInstanceId,
    backend,
    capturedAt,
  ))?.contextSnapshot || null;
}
