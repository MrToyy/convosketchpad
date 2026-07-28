import { describe, expect, it } from 'vitest';
import { projectCanvasGatewayEvent } from './canvas-gateway-events.js';

describe('Canvas Gateway event projection', () => {
  it('normalizes correlation and assistant content without exposing transport shape upstream', () => {
    expect(projectCanvasGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: {
        run_id: 'run-1',
        sessionKey: 'session-key',
        state: 'delta',
        message: {
          content: [{ type: 'text', text: 'partial' }, ' output'],
        },
      },
    })).toEqual({
      runId: 'run-1',
      sessionKey: 'session-key',
      state: 'delta',
      assistantText: 'partial output',
      terminal: false,
      failure: null,
    });
  });

  it('classifies final, error, and aborted chat events as terminal', () => {
    expect(projectCanvasGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: { runId: 'run-1', state: 'final', message: 'done' },
    })).toMatchObject({ state: 'final', terminal: true, assistantText: 'done' });
    expect(projectCanvasGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: { runId: 'run-2', state: 'error', errorMessage: 'failed' },
    })).toMatchObject({ state: 'error', terminal: true, failure: 'failed' });
    expect(projectCanvasGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: { runId: 'run-3', state: 'aborted', stopReason: 'cancelled' },
    })).toMatchObject({ state: 'aborted', terminal: true, failure: 'cancelled' });
  });
});
