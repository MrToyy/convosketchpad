import type { OutgoingUploadPayload, UploadAttachmentDescriptor } from '@/features/chat/types';

const UPLOAD_MANIFEST_OPEN = '<nerve-upload-manifest>';
const UPLOAD_MANIFEST_CLOSE = '</nerve-upload-manifest>';

function sanitizeUploadDescriptor(
  descriptor: UploadAttachmentDescriptor,
  exposeInlineBase64ToAgent: boolean,
): UploadAttachmentDescriptor {
  if (descriptor.mode !== 'inline' || !descriptor.inline) return descriptor;
  return {
    ...descriptor,
    inline: {
      ...descriptor.inline,
      previewUrl: undefined,
      base64: exposeInlineBase64ToAgent ? descriptor.inline.base64 : '',
    },
  };
}

export function appendUploadManifest(text: string, uploadPayload?: OutgoingUploadPayload): string {
  if (!uploadPayload?.manifest.enabled || uploadPayload.descriptors.length === 0) return text;
  const manifest = {
    version: 1,
    attachments: uploadPayload.descriptors.map((descriptor) =>
      sanitizeUploadDescriptor(descriptor, uploadPayload.manifest.exposeInlineBase64ToAgent)),
  };
  return `${text}\n\n${UPLOAD_MANIFEST_OPEN}${JSON.stringify(manifest)}${UPLOAD_MANIFEST_CLOSE}`;
}

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
  uploadPayload?: OutgoingUploadPayload;
  idempotencyKey: string;
}): Promise<ChatSendAck> {
  const rpcParams: Record<string, unknown> = {
    sessionKey: params.sessionKey,
    message: appendUploadManifest(params.text, params.uploadPayload),
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
