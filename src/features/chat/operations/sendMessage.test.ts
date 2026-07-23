import { describe, expect, it, vi } from 'vitest';
import { appendUploadManifest, sendChatMessage } from './sendMessage';
import type { OutgoingUploadPayload } from '../types';

const payload: OutgoingUploadPayload = {
  descriptors: [{
    id: 'a', origin: 'upload', mode: 'inline', name: 'a.png', mimeType: 'image/png', sizeBytes: 3,
    inline: { encoding: 'base64', base64: 'abc', base64Bytes: 3, previewUrl: 'data:image/png;base64,abc', compressed: false },
    policy: { forwardToSubagents: false },
  }],
  manifest: { enabled: true, exposeInlineBase64ToAgent: false, allowSubagentForwarding: false },
};

describe('Canvas gateway send helpers', () => {
  it('sanitizes upload manifests', () => {
    const result = appendUploadManifest('hello', payload);
    expect(result).toContain('<nerve-upload-manifest>');
    expect(result).not.toContain('data:image');
    expect(result).not.toContain('"base64":"abc"');
  });
  it('sends Canvas text and attachments through chat.send', async () => {
    const rpc = vi.fn().mockResolvedValue({ runId: 'run-1', status: 'started' });
    const result = await sendChatMessage({ rpc, sessionKey: 'agent:main:canvas:b', text: 'hello', idempotencyKey: 'r', attachments: [{ fileName: 'a.png', mimeType: 'image/png', content: 'abc' }] });
    expect(rpc).toHaveBeenCalledWith('chat.send', expect.objectContaining({ sessionKey: 'agent:main:canvas:b', deliver: false }));
    expect(result).toEqual({ runId: 'run-1', status: 'started' });
  });
});
