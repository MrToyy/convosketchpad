import { describe, expect, it } from 'vitest';
import { extractOpenClawTurn } from './transcript.js';

const input = { userInput: '请生成图片', createdAt: 1_000, runId: 'run-1' };

describe('OpenClaw transcript projection', () => {
  it('extracts enriched image blocks from the matching turn', () => {
    const snapshot = extractOpenClawTurn([
      { role: 'user', content: '请生成图片', timestamp: 900 },
      { role: 'assistant', content: [{ type: 'text', text: '图片已经生成。' }], timestamp: 2_000 },
      {
        role: 'assistant',
        content: [{
          type: 'image',
          openUrl: '/api/chat/media/result/full',
          alt: 'result.png',
          mimeType: 'image/png',
          bytes: 123,
        }],
        idempotencyKey: 'run-1:assistant-media',
        timestamp: 2_500,
      },
    ], input);

    expect(snapshot.agentOutput).toBe('图片已经生成。');
    expect(snapshot.artifacts).toEqual([{
      name: 'result.png',
      mimeType: 'image/png',
      sizeBytes: 123,
      uri: '/api/chat/media/result/full',
    }]);
  });

  it('isolates turns and deduplicates native media with Markdown links', () => {
    const snapshot = extractOpenClawTurn([
      { role: 'user', content: '更早的问题', timestamp: 100 },
      { role: 'assistant', content: '更早的回答', timestamp: 200 },
      { role: 'user', content: '请生成图片', timestamp: 900 },
      {
        role: 'assistant',
        content: '[查看文件](https://example.com/result.pdf)\n![图片](https://example.com/result.png)',
        MediaUrls: ['https://example.com/result.png'],
        MediaTypes: ['image/png'],
        timestamp: 2_000,
      },
      { role: 'user', content: '下一轮问题', timestamp: 3_000 },
      { role: 'assistant', content: '下一轮回答', timestamp: 4_000 },
    ], input);

    expect(snapshot.agentOutput).not.toContain('下一轮回答');
    expect(snapshot.artifacts.map((artifact) => artifact.uri)).toEqual([
      'https://example.com/result.png',
      'https://example.com/result.pdf',
    ]);
  });

  it('extracts tool-result paths but never treats user uploads as artifacts', () => {
    const snapshot = extractOpenClawTurn([
      { role: 'user', content: '请生成图片', MediaPath: '/tmp/source.png', timestamp: 900 },
      {
        role: 'toolResult',
        content: [{ type: 'tool_result', path: '/tmp/report.pdf', name: '报告', mimeType: 'application/pdf' }],
        timestamp: 1_500,
      },
      { role: 'assistant', content: '已生成报告。', timestamp: 2_000 },
    ], input);

    expect(snapshot.artifacts).toEqual([{
      name: '报告',
      mimeType: 'application/pdf',
      uri: '/tmp/report.pdf',
    }]);
  });

  it('marks a user-only matching turn without inventing a response', () => {
    expect(extractOpenClawTurn([
      { role: 'user', content: '请生成图片', timestamp: 900 },
    ], input)).toEqual({ agentOutput: '', artifacts: [], matchedTurn: true });
  });
});
