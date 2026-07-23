import type { AgentEventPayload, ChatEventPayload, ChatMessage, ContentBlock, GatewayEvent } from '@/types';
import { describeToolUse, extractText } from '@/utils/helpers';

const ACTIVE_STATES = new Set(['thinking', 'processing', 'tool_use', 'executing', 'tool', 'started', 'delta']);

export function isActiveAgentState(state: string): boolean {
  return ACTIVE_STATES.has(state);
}

export type StreamEventType =
  | 'lifecycle_start' | 'lifecycle_end' | 'assistant_stream'
  | 'agent_tool_start' | 'agent_tool_result' | 'agent_state'
  | 'chat_started' | 'chat_delta' | 'chat_final' | 'chat_error' | 'chat_aborted' | 'ignore';

export interface ClassifiedEvent {
  type: StreamEventType;
  source: 'agent' | 'chat';
  sessionKey?: string;
  runId?: string;
  chatSeq?: number;
  frameSeq?: number;
  agentPayload?: AgentEventPayload;
  chatPayload?: ChatEventPayload;
}

export function classifyStreamEvent(event: GatewayEvent): ClassifiedEvent | null {
  if (event.event === 'agent') {
    const payload = (event.payload || {}) as AgentEventPayload;
    const base = {
      source: 'agent' as const,
      sessionKey: payload.sessionKey,
      runId: typeof (payload as { runId?: unknown }).runId === 'string' ? (payload as { runId: string }).runId : undefined,
      chatSeq: typeof (payload as { seq?: unknown }).seq === 'number' ? (payload as { seq: number }).seq : undefined,
      frameSeq: event.seq,
      agentPayload: payload,
    };
    if (payload.stream === 'lifecycle') {
      const phase = (payload.data as Record<string, unknown> | undefined)?.phase;
      if (phase === 'start') return { ...base, type: 'lifecycle_start' };
      if (phase === 'end' || phase === 'error') return { ...base, type: 'lifecycle_end' };
    }
    if (payload.stream === 'assistant') return { ...base, type: 'assistant_stream' };
    if (payload.stream === 'tool') {
      if (payload.data?.phase === 'start' && payload.data.name && payload.data.toolCallId) return { ...base, type: 'agent_tool_start' };
      if (payload.data?.phase === 'result' && payload.data.toolCallId) return { ...base, type: 'agent_tool_result' };
    }
    if (payload.state || payload.agentState) return { ...base, type: 'agent_state' };
    return { ...base, type: 'ignore' };
  }
  if (event.event === 'chat') {
    const payload = (event.payload || {}) as ChatEventPayload;
    const base = { source: 'chat' as const, sessionKey: payload.sessionKey, runId: payload.runId, chatSeq: payload.seq, frameSeq: event.seq, chatPayload: payload };
    const typeByState: Record<string, StreamEventType> = {
      started: 'chat_started', delta: 'chat_delta', final: 'chat_final', error: 'chat_error', aborted: 'chat_aborted',
    };
    return { ...base, type: typeByState[payload.state || ''] || 'ignore' };
  }
  return null;
}

export function extractStreamDelta(chatPayload: ChatEventPayload): { text: string; cleaned: string } | null {
  if (chatPayload.state !== 'delta' || !chatPayload.message || typeof chatPayload.message === 'string') return null;
  const text = extractText(chatPayload.message);
  return text === undefined ? null : { text, cleaned: text };
}

export interface FinalMessageData { message: ChatMessage; text: string }

function syntheticAssistantMessage(content: string | ContentBlock[]): ChatMessage {
  return { role: 'assistant', content, timestamp: Date.now() };
}

export function extractFinalMessages(payload: ChatEventPayload): ChatMessage[] {
  if (Array.isArray(payload.messages) && payload.messages.length) return payload.messages;
  if (payload.message) return [typeof payload.message === 'string' ? syntheticAssistantMessage(payload.message) : payload.message];
  if (Array.isArray(payload.content) && payload.content.length) return [syntheticAssistantMessage(payload.content)];
  return [];
}

export function extractFinalMessage(payload: ChatEventPayload): FinalMessageData | null {
  const messages = extractFinalMessages(payload);
  if (!messages.length) return null;
  const message = [...messages].reverse().find((item) => item.role === 'assistant') || messages[messages.length - 1];
  return { message, text: extractText(message) || '' };
}

export interface ActivityLogEntry {
  id: string; toolName: string; description: string; startedAt: number;
  phase: 'running' | 'completed'; completedAt?: number;
}
export type ProcessingStage = 'thinking' | 'tool_use' | null;

export function buildActivityLogEntry(payload: AgentEventPayload): ActivityLogEntry | null {
  const data = payload.data;
  if (!data || data.phase !== 'start' || !data.name || !data.toolCallId) return null;
  return { id: data.toolCallId, toolName: data.name, description: describeToolUse(data.name, data.args || {}) || data.name, startedAt: Date.now(), phase: 'running' };
}
export function markToolCompleted(log: ActivityLogEntry[], id: string): ActivityLogEntry[] {
  return log.map((entry) => entry.id === id ? { ...entry, phase: 'completed', completedAt: Date.now() } : entry);
}
export function appendActivityEntry(log: ActivityLogEntry[], entry: ActivityLogEntry, maxEntries = 6): ActivityLogEntry[] {
  return [...log, entry].slice(-maxEntries);
}
export function deriveProcessingStage(state: string): ProcessingStage {
  if (state === 'thinking' || state === 'processing') return 'thinking';
  if (state === 'tool_use' || state === 'executing' || state === 'tool') return 'tool_use';
  return null;
}
