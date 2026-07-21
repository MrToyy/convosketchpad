import { compressImage } from '@/features/chat/image-compress';

export const CANVAS_INLINE_IMAGE_MAX_BYTES = 1_800_000;
export const CANVAS_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export interface GatewayAttachment {
  fileName: string;
  mimeType: string;
  content: string;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      resolve(value.split(',', 2)[1] || '');
    };
    reader.onerror = () => reject(reader.error || new Error(`无法读取附件：${file.name}`));
    reader.readAsDataURL(file);
  });
}

export async function prepareGatewayAttachment(file: File): Promise<GatewayAttachment> {
  const mimeType = file.type || 'application/octet-stream';

  if (!mimeType.startsWith('image/')) {
    if (file.size > CANVAS_ATTACHMENT_MAX_BYTES) {
      throw new Error(`附件“${file.name}”超过 20 MB，无法发送给 OpenClaw`);
    }
    return { fileName: file.name, mimeType, content: await readAsBase64(file) };
  }

  if (file.size <= CANVAS_INLINE_IMAGE_MAX_BYTES) {
    return { fileName: file.name, mimeType, content: await readAsBase64(file) };
  }

  const compressed = await compressImage(file, {
    contextMaxBytes: CANVAS_INLINE_IMAGE_MAX_BYTES,
    contextTargetBytes: 1_650_000,
    maxDimension: 2048,
    minDimension: 384,
    webpQuality: 82,
  });
  if (compressed.bytes > CANVAS_INLINE_IMAGE_MAX_BYTES) {
    throw new Error(`图片“${file.name}”无法压缩到 OpenClaw 可直接识别的大小`);
  }
  return { fileName: file.name, mimeType: compressed.mimeType, content: compressed.base64 };
}

export async function prepareGatewayAttachments(files: File[]): Promise<GatewayAttachment[]> {
  const prepared: GatewayAttachment[] = [];
  for (const file of files) prepared.push(await prepareGatewayAttachment(file));
  return prepared;
}
