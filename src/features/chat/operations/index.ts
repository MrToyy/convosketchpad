export { appendUploadManifest, sendChatMessage } from './sendMessage';
export type { ChatSendAck, ChatSendStatus, GatewayAttachmentPayload } from './sendMessage';
export {
  appendActivityEntry,
  buildActivityLogEntry,
  classifyStreamEvent,
  deriveProcessingStage,
  extractFinalMessage,
  extractFinalMessages,
  extractStreamDelta,
  isActiveAgentState,
  markToolCompleted,
} from './streamEventHandler';
export type { ActivityLogEntry, ClassifiedEvent, FinalMessageData, ProcessingStage, StreamEventType } from './streamEventHandler';
