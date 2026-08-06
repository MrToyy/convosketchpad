import { describe, expect, it } from 'vitest';
import { projectOpenClawEvent } from './adapter.js';

describe('OpenClaw AgentRuntime event projection', () => {
  it('normalizes correlation and assistant content without exposing transport shape upstream', () => {
    expect(projectOpenClawEvent({
      type: 'event',
      event: 'chat',
      payload: {
        run_id: 'run-1',
        sessionKey: 'session-key',
        state: 'delta',
        deltaText: ' output',
        message: { content: [{ type: 'text', text: 'partial' }, ' output'] },
      },
    })).toMatchObject({
      runtimeId: 'openclaw',
      type: 'output.text.delta',
      text: ' output',
      conversationRef: { opaque: { sessionKey: 'session-key' } },
      turnRef: { opaque: { runId: 'run-1', sessionKey: 'session-key' } },
    });
  });

  it('projects cumulative and replacement snapshots without treating them as append-only deltas', () => {
    expect(projectOpenClawEvent({
      type: 'event',
      event: 'chat',
      payload: { state: 'delta', message: 'cumulative text' },
    })).toMatchObject({ type: 'output.text.snapshot', text: 'cumulative text' });
    expect(projectOpenClawEvent({
      type: 'event',
      event: 'chat',
      payload: { state: 'delta', deltaText: 'replacement', replace: true },
    })).toMatchObject({ type: 'output.text.snapshot', text: 'replacement' });
  });

  it('normalizes final, error, and interrupted turn events', () => {
    const finalEvent = {
      type: 'event', event: 'chat', payload: { runId: 'run-1', state: 'final', message: 'done' },
    } as const;
    const firstProjection = projectOpenClawEvent(finalEvent);
    expect(firstProjection).toMatchObject({ type: 'turn.completed', text: 'done' });
    expect(projectOpenClawEvent(finalEvent)?.eventId).toBe(firstProjection?.eventId);
    expect(projectOpenClawEvent({
      type: 'event', event: 'chat', payload: { runId: 'run-2', state: 'error', errorMessage: 'failed' },
    })).toMatchObject({ type: 'turn.failed', error: 'failed' });
    expect(projectOpenClawEvent({
      type: 'event', event: 'chat', payload: { runId: 'run-3', state: 'aborted', stopReason: 'cancelled' },
    })).toMatchObject({ type: 'turn.interrupted', error: 'cancelled' });
  });

  it('normalizes exec and plugin approvals without retaining environment data', () => {
    const exec = projectOpenClawEvent({
      type: 'event',
      event: 'exec.approval.requested',
      payload: {
        id: 'approval-1',
        expiresAtMs: 123,
        request: {
          sessionKey: 'session-key',
          commandPreview: 'npm test --token=hidden Authorization: Bearer private-value',
          env: { SECRET: 'hidden' },
          allowedDecisions: ['allow-once', 'deny'],
        },
      },
    });
    expect(exec).toMatchObject({
      type: 'approval.required',
      approvalRef: { opaque: { approvalId: 'approval-1', approvalKind: 'exec' } },
      approval: {
        category: 'command',
        description: 'npm test --token=[REDACTED] Authorization: Bearer [REDACTED]',
        choices: [
          expect.objectContaining({ id: 'allow-once', intent: 'grant', scope: 'item' }),
          expect.objectContaining({ id: 'deny', intent: 'deny' }),
        ],
        expiresAt: 123,
      },
    });
    expect(JSON.stringify(exec)).not.toContain('SECRET');
    expect(JSON.stringify(exec)).not.toContain('hidden');
    expect(JSON.stringify(exec)).not.toContain('private-value');

    expect(projectOpenClawEvent({
      type: 'event',
      event: 'plugin.approval.resolved',
      payload: { id: 'approval-2', decision: 'deny', resolvedBy: 'operator' },
    })).toMatchObject({
      type: 'approval.resolved',
      resolution: { choiceId: 'deny' },
      resolvedBy: 'operator',
      approvalRef: { opaque: { approvalKind: 'plugin' } },
    });
  });
});
