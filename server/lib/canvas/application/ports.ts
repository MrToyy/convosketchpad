import type {
  AgentRuntime,
  AgentProfileRef,
  ConversationHandle,
} from '../../agent-runtimes/contract.js';

/**
 * Synchronous, side-effect-free factory used inside Canvas transactions.
 * Adapters may encode opaque conversation identity, but persistence never reads it.
 */
export type ConversationHandleFactory = (input: {
  profile: AgentProfileRef;
  localConversationId: string;
}) => ConversationHandle;

/** Resolves a configured Runtime without exposing registry ownership to Canvas code. */
export type AgentRuntimeResolver = (runtimeId: string) => AgentRuntime;
