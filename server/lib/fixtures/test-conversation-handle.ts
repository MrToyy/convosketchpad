import { runtimeHandle } from '../agent-runtimes/contract.js';
import type { ConversationHandleFactory } from '../canvas/application/ports.js';

export const testConversationHandleFactory: ConversationHandleFactory = ({
  profile,
  localConversationId,
}) => runtimeHandle(profile.runtimeId, {
  sessionKey: `agent:${profile.profileId}:canvas:${localConversationId}`,
});
