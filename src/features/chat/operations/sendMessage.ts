type RpcFn = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export type ChatSendStatus = 'started' | 'in_flight' | 'ok';

export interface ChatSendAck {
  runId?: string;
  status?: ChatSendStatus;
}

export interface GatewayAttachmentPayload {
  fileName?: string;
  mimeType: string;
  content: string;
}

/** Low-level OpenClaw `chat.send` transport used by Canvas interactions. */
export async function sendChatMessage(params: {
  rpc: RpcFn;
  sessionKey: string;
  text: string;
  attachments?: GatewayAttachmentPayload[];
  idempotencyKey: string;
}): Promise<ChatSendAck> {
  const rpcParams: Record<string, unknown> = {
    sessionKey: params.sessionKey,
    message: params.text,
    deliver: false,
    idempotencyKey: params.idempotencyKey,
  };
  if (params.attachments?.length) {
    rpcParams.attachments = params.attachments.map(({ fileName, mimeType, content }) => ({
      ...(fileName ? { fileName } : {}), mimeType, content,
    }));
  }
  const raw = await params.rpc('chat.send', rpcParams) as { runId?: unknown; status?: unknown } | null;
  const status = typeof raw?.status === 'string' && ['started', 'in_flight', 'ok'].includes(raw.status)
    ? raw.status as ChatSendStatus
    : undefined;
  return { runId: typeof raw?.runId === 'string' ? raw.runId : undefined, status };
}
