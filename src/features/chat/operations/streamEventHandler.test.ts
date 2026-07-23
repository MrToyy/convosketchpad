import { describe, expect, it } from 'vitest';
import { classifyStreamEvent, extractStreamDelta } from './streamEventHandler';

describe('Canvas stream event helpers', () => {
  it('classifies Gateway chat and agent protocol events', () => {
    expect(classifyStreamEvent({ type: 'event', event: 'chat', payload: { state: 'final', runId: 'r' } })?.type).toBe('chat_final');
    expect(classifyStreamEvent({ type: 'event', event: 'agent', payload: { stream: 'tool', data: { phase: 'start', name: 'read', toolCallId: 't' } } })?.type).toBe('agent_tool_start');
  });
  it('returns unmodified text without TTS or chart parsing', () => {
    const result = extractStreamDelta({ state: 'delta', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } });
    expect(result).toEqual({ text: 'hello', cleaned: 'hello' });
  });
});
