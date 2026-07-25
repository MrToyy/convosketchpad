import { describe, expect, it, vi } from 'vitest';
import { sendChatMessage } from './sendMessage';

describe('Canvas gateway send helpers', () => {
  it('sends Canvas text and attachments through chat.send', async () => {
    const rpc = vi.fn().mockResolvedValue({ runId: 'run-1', status: 'started' });
    const result = await sendChatMessage({ rpc, sessionKey: 'agent:main:canvas:b', text: 'hello', idempotencyKey: 'r', attachments: [{ fileName: 'a.png', mimeType: 'image/png', content: 'abc' }] });
    expect(rpc).toHaveBeenCalledWith('chat.send', expect.objectContaining({
      sessionKey: 'agent:main:canvas:b',
      deliver: false,
      message: 'hello',
      attachments: [{ fileName: 'a.png', mimeType: 'image/png', content: 'abc' }],
    }));
    expect(JSON.stringify(rpc.mock.calls[0])).not.toContain('convosketchpad-upload-manifest');
    expect(result).toEqual({ runId: 'run-1', status: 'started' });
  });
});
