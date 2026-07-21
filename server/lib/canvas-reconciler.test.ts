import { describe, expect, it } from 'vitest';
import type { InteractionRecord } from './canvas-db.js';
import { canvasArtifactProxyUrl, extractCanvasTranscript, resolveOpenClawArtifactUrl } from './canvas-reconciler.js';

function interaction(overrides: Partial<InteractionRecord> = {}): InteractionRecord {
  return {
    id: 'interaction-1',
    branchId: 'branch-1',
    parentInteractionId: null,
    runId: 'run-1',
    userInput: '请生成图片',
    agentOutput: '',
    status: 'streaming',
    attachments: [],
    artifacts: [],
    sessionMetadata: {},
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('Canvas transcript reconciliation', () => {
  it('uses the enriched assistant message and extracts OpenClaw URL image blocks', () => {
    const snapshot = extractCanvasTranscript([
      { role: 'user', content: '请生成图片', timestamp: 900 },
      { role: 'assistant', content: [{ type: 'text', text: '图片已经生成。' }], timestamp: 2_000 },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '图片已经生成。' },
          {
            type: 'image',
            url: '/api/chat/media/outgoing/agent%3Amain%3Acanvas%3Abranch-1/image-1/full',
            openUrl: '/api/chat/media/outgoing/agent%3Amain%3Acanvas%3Abranch-1/image-1/full',
            alt: 'result.png',
            mimeType: 'image/png',
            bytes: 123,
          },
        ],
        idempotencyKey: 'run-1:assistant-media',
        timestamp: 2_500,
      },
    ], interaction());

    expect(snapshot.agentOutput).toBe('图片已经生成。');
    expect(snapshot.artifacts).toEqual([{
      name: 'result.png',
      mimeType: 'image/png',
      sizeBytes: 123,
      uri: '/api/chat/media/outgoing/agent%3Amain%3Acanvas%3Abranch-1/image-1/full',
    }]);
  });

  it('isolates the requested turn and deduplicates media and Markdown links', () => {
    const snapshot = extractCanvasTranscript([
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
    ], interaction());

    expect(snapshot.agentOutput).not.toContain('下一轮回答');
    expect(snapshot.artifacts.map((artifact) => artifact.uri)).toEqual([
      'https://example.com/result.png',
      'https://example.com/result.pdf',
    ]);
  });

  it('extracts file paths from tool results without copying file contents', () => {
    const snapshot = extractCanvasTranscript([
      { role: 'user', content: '请生成图片', timestamp: 900 },
      {
        role: 'toolResult',
        content: [{ type: 'tool_result', path: '/tmp/report.pdf', name: '报告', mimeType: 'application/pdf' }],
        timestamp: 1_500,
      },
      { role: 'assistant', content: '已生成报告。', timestamp: 2_000 },
    ], interaction());

    expect(snapshot.artifacts).toContainEqual({
      name: '报告',
      mimeType: 'application/pdf',
      uri: '/api/files?path=%2Ftmp%2Freport.pdf',
    });
  });

  it('never classifies user upload manifests or input media as Agent artifacts', () => {
    const snapshot = extractCanvasTranscript([
      {
        role: 'user',
        content: '请编辑图片\n\n<nerve-upload-manifest>{"attachments":[{"reference":{"path":"/tmp/source.png","uri":"file:///tmp/source.png"}}]}</nerve-upload-manifest>',
        MediaPath: '/tmp/source.png',
        MediaType: 'image/png',
        timestamp: 900,
      },
      { role: 'assistant', content: '已经完成。', timestamp: 2_000 },
    ], interaction({ userInput: '请编辑图片' }));

    expect(snapshot.agentOutput).toBe('已经完成。');
    expect(snapshot.artifacts).toEqual([]);
  });

  it('only proxies OpenClaw outgoing media paths', () => {
    const uri = '/api/chat/media/outgoing/agent%3Amain%3Acanvas%3Abranch-1/image-1/full';
    expect(canvasArtifactProxyUrl(uri)).toContain('/api/canvas/openclaw-artifact?uri=');
    expect(canvasArtifactProxyUrl('https://example.com/file.png')).toBe('https://example.com/file.png');
    expect(resolveOpenClawArtifactUrl(uri)?.pathname).toBe(uri);
    expect(resolveOpenClawArtifactUrl('https://evil.example/file')).toBeNull();
  });
});
