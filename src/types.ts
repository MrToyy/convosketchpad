/** A single entry in the agent activity log (displayed in the TopBar). */
export interface AgentLogEntry {
  icon: string;
  text: string;
  ts: number;
}

/** A gateway event entry shown in the events panel. */
export interface EventEntry {
  badge: string;
  badgeCls: string;
  desc: string;
  ts: Date;
}

/** Aggregated token usage and cost data from the gateway. */
export interface TokenData {
  entries?: TokenEntry[];
  totalCost?: number;
  totalInput?: number;
  totalOutput?: number;
  totalCacheRead?: number;
  totalMessages?: number;
  persistent?: {
    totalCost: number;
    totalInput: number;
    totalOutput: number;
    lastUpdated: string;
  };
  updatedAt?: number;
}

/** Per-source breakdown of token usage and cost. */
export interface TokenEntry {
  source: string;
  cost: number;
  messageCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  errorCount?: number;
}

/** Possible roles for chat messages */
export type ChatMessageRole = 'user' | 'assistant' | 'tool' | 'toolResult' | 'system';

/** Discriminated content block types */
export type ContentBlockType = 'text' | 'tool_use' | 'toolCall' | 'tool_result' | 'toolResult' | 'image' | 'thinking';

/** A single chat message (user, assistant, tool, or system). */
export interface ChatMessage {
  role: ChatMessageRole;
  content: string | ContentBlock[];
  text?: string;
  timestamp?: string | number;
  createdAt?: string | number;
  ts?: string | number;
  MediaPath?: string;
  MediaPaths?: string[];
  MediaType?: string;
  MediaTypes?: string[];
  MediaUrl?: string;
  MediaUrls?: string[];
}

/** A content block within a multi-part message (text, tool call, image, etc.). */
export interface ContentBlock {
  type: ContentBlockType;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  id?: string;
  toolCallId?: string;
  arguments?: string | Record<string, unknown>;
  content?: string | ContentBlock[];
  /** Image content block fields (from gateway) */
  data?: string;       // base64 image data
  mimeType?: string;   // e.g. "image/jpeg"
  omitted?: boolean;
  bytes?: number;
  /** Anthropic-style image source */
  source?: { type?: string; media_type?: string; data?: string };
}

/** Gateway message types */
export interface GatewayEvent {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: { presence: number; health: number };
}

export interface GatewayRequest {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface GatewayResponse {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message: string; code?: string };
}

export type GatewayMessage = GatewayEvent | GatewayRequest | GatewayResponse;

// ─── Typed event payloads ────────────────────────────────────────────

/** Payload for 'chat' events */
export interface ChatEventPayload {
  sessionKey?: string;
  state?: string;
  runId?: string;
  seq?: number;
  message?: ChatMessage | string;
  messages?: ChatMessage[];
  content?: ContentBlock[];
  error?: string;
  errorMessage?: string;
  stopReason?: string;
}

/** Payload for 'agent' events (state changes + tool streaming) */
export interface AgentEventPayload {
  sessionKey?: string;
  state?: string;
  agentState?: string;
  /** Present when stream === 'tool' */
  stream?: string;
  /** Tool stream data (present when stream === 'tool') */
  data?: AgentToolStreamData;
  totalTokens?: number;
  contextTokens?: number;
}

/** Data within an agent tool-stream event */
export interface AgentToolStreamData {
  phase: 'start' | 'result';
  toolCallId?: string;
  name?: string;
  args?: Record<string, unknown>;
}
