import { describe, expect, it } from 'vitest';
import type { InteractionRecord } from './canvas-db.js';
import {
  canvasTranscriptHasResponse,
  extractCanvasTranscript,
  sessionReflectsInteractionRun,
} from './canvas-reconciler.js';

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
      uri: '/tmp/report.pdf',
    });
  });

  it('never classifies user upload manifests or input media as Agent artifacts', () => {
    const snapshot = extractCanvasTranscript([
      {
        role: 'user',
        content: '请编辑图片\n\n<convosketchpad-upload-manifest>{"attachments":[{"reference":{"path":"/tmp/source.png","uri":"file:///tmp/source.png"}}]}</convosketchpad-upload-manifest>',
        MediaPath: '/tmp/source.png',
        MediaType: 'image/png',
        timestamp: 900,
      },
      { role: 'assistant', content: '已经完成。', timestamp: 2_000 },
    ], interaction({ userInput: '请编辑图片' }));

    expect(snapshot.agentOutput).toBe('已经完成。');
    expect(snapshot.artifacts).toEqual([]);
  });

  it('does not treat a stable empty Transcript as an Agent response', () => {
    const snapshot = extractCanvasTranscript([
      { role: 'user', content: '请生成图片', timestamp: 900 },
    ], interaction());

    expect(snapshot.matchedInteraction).toBe(true);
    expect(canvasTranscriptHasResponse(snapshot)).toBe(false);
  });

  it('requires terminal Session activity to belong to the current interaction', () => {
    const current = interaction({ createdAt: 10_000 });

    expect(sessionReflectsInteractionRun({ status: 'done', updatedAt: 9_999 }, current)).toBe(false);
    expect(sessionReflectsInteractionRun({ agentState: 'idle', busy: false, processing: false, updatedAt: 10_100 }, current)).toBe(false);
    expect(sessionReflectsInteractionRun({ status: 'done', updatedAt: 10_250 }, current)).toBe(true);
    expect(sessionReflectsInteractionRun({ agentState: 'idle', busy: false, processing: false, startedAt: 9_750 }, current)).toBe(true);
  });

});
