import { describe, expect, it } from 'vitest';
import { RuntimeTextPreviewAssembler } from './runtime-text-preview.js';

const base = {
  runtimeId: 'codex',
  createdAt: 1,
};

describe('Runtime text preview assembler', () => {
  it('appends deltas and replaces them with the authoritative completed message', () => {
    const previews = new RuntimeTextPreviewAssembler();
    expect(previews.apply('interaction-1', {
      ...base, type: 'output.text.delta', messageId: 'message-1', text: 'Hel',
    })).toBe('Hel');
    expect(previews.apply('interaction-1', {
      ...base, type: 'output.text.delta', messageId: 'message-1', text: 'lo',
    })).toBe('Hello');
    expect(previews.apply('interaction-1', {
      ...base, type: 'output.message.completed', messageId: 'message-1', text: 'Hello!',
    })).toBe('Hello!');
    expect(previews.apply('interaction-1', {
      ...base, type: 'output.text.delta', messageId: 'message-2', text: 'Next',
    })).toBe('Hello!\nNext');
  });

  it('replaces cumulative Runtime snapshots instead of duplicating them', () => {
    const previews = new RuntimeTextPreviewAssembler();
    expect(previews.apply('interaction-1', {
      ...base, type: 'output.text.snapshot', text: 'partial',
    })).toBe('partial');
    expect(previews.apply('interaction-1', {
      ...base, type: 'output.text.snapshot', text: 'partial output',
    })).toBe('partial output');
  });
});
