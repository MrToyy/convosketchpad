import { describe, expect, it } from 'vitest';
import {
  CANVAS_ATTACHMENT_MAX_BYTES,
  prepareDeliveryAttachment,
} from './attachments';

describe('Canvas delivery attachments', () => {
  it('sends small images as native image attachments with their file name', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'source.png', { type: 'image/png' });
    const attachment = await prepareDeliveryAttachment(file);

    expect(attachment).toMatchObject({ fileName: 'source.png', mimeType: 'image/png' });
    expect(attachment.content).toBe('AQID');
  });

  it('sends non-image files through the same native attachment field', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const attachment = await prepareDeliveryAttachment(file);

    expect(attachment).toMatchObject({ fileName: 'notes.txt', mimeType: 'text/plain' });
    expect(attachment.content).toBe('aGVsbG8=');
  });

  it('rejects oversized new non-image files instead of silently sending only a path', async () => {
    const file = new File([new Uint8Array(CANVAS_ATTACHMENT_MAX_BYTES + 1)], 'large.bin', { type: 'application/octet-stream' });
    await expect(prepareDeliveryAttachment(file)).rejects.toThrow('超过 20 MB');
  });

  it('localizes attachment validation errors for English Canvas UI', async () => {
    const file = new File([new Uint8Array(CANVAS_ATTACHMENT_MAX_BYTES + 1)], 'large.bin', { type: 'application/octet-stream' });
    await expect(prepareDeliveryAttachment(file, 'en')).rejects.toThrow('exceeds 20 MB');
  });
});
