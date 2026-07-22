import { compressImage } from '@/features/chat/image-compress';
import { DEFAULT_LANGUAGE, type Language } from '@/lib/language';
import { CanvasLocalizedError, getCanvasCopy } from './messages';

export const CANVAS_INLINE_IMAGE_MAX_BYTES = 1_800_000;
export const CANVAS_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export interface GatewayAttachment {
  fileName: string;
  mimeType: string;
  content: string;
}

function readAsBase64(file: File, language: Language): Promise<string> {
  const copy = getCanvasCopy(language);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      resolve(value.split(',', 2)[1] || '');
    };
    reader.onerror = () => reject(reader.error || new CanvasLocalizedError(copy.attachmentReadFailed(file.name)));
    reader.readAsDataURL(file);
  });
}

export async function prepareGatewayAttachment(file: File, language: Language = DEFAULT_LANGUAGE): Promise<GatewayAttachment> {
  const copy = getCanvasCopy(language);
  const mimeType = file.type || 'application/octet-stream';

  if (!mimeType.startsWith('image/')) {
    if (file.size > CANVAS_ATTACHMENT_MAX_BYTES) {
      throw new CanvasLocalizedError(copy.attachmentTooLarge(file.name));
    }
    return { fileName: file.name, mimeType, content: await readAsBase64(file, language) };
  }

  if (file.size <= CANVAS_INLINE_IMAGE_MAX_BYTES) {
    return { fileName: file.name, mimeType, content: await readAsBase64(file, language) };
  }

  const compressed = await compressImage(file, {
    contextMaxBytes: CANVAS_INLINE_IMAGE_MAX_BYTES,
    contextTargetBytes: 1_650_000,
    maxDimension: 2048,
    minDimension: 384,
    webpQuality: 82,
  });
  if (compressed.bytes > CANVAS_INLINE_IMAGE_MAX_BYTES) {
    throw new CanvasLocalizedError(copy.imageCompressionFailed(file.name));
  }
  return { fileName: file.name, mimeType: compressed.mimeType, content: compressed.base64 };
}

export async function prepareGatewayAttachments(files: File[], language: Language = DEFAULT_LANGUAGE): Promise<GatewayAttachment[]> {
  const prepared: GatewayAttachment[] = [];
  for (const file of files) prepared.push(await prepareGatewayAttachment(file, language));
  return prepared;
}
