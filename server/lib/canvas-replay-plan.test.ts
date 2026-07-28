import { describe, expect, it } from 'vitest';
import { buildCanvasReplayPlan } from './canvas-replay-plan.js';
import type { CanvasContextResource } from './canvas-db.js';

function resource(overrides: Partial<CanvasContextResource> = {}): CanvasContextResource {
  return {
    id: 'interaction-1:artifact:0',
    sourceInteractionId: 'interaction-1',
    source: 'agent_artifact',
    name: 'result.png',
    mimeType: 'image/png',
    sizeBytes: 100,
    uri: `/api/canvas/artifacts/canvas-1/interaction-1/${'a'.repeat(40)}`,
    available: true,
    ...overrides,
  };
}

describe('Canvas replay plan', () => {
  it('keeps every logical reference while physically deduplicating identical content', () => {
    const first = resource();
    const repeated = resource({
      id: 'interaction-2:attachment:0',
      sourceInteractionId: 'interaction-2',
      source: 'user_attachment',
      name: 'reused.png',
      uri: `/api/canvas/attachments/canvas-1/${'a'.repeat(40)}`,
    });
    const plan = buildCanvasReplayPlan({
      interactions: [
        { id: 'interaction-1', user: 'one', assistant: 'answer one' },
        { id: 'interaction-2', user: 'two', assistant: 'answer two' },
      ],
      resources: [first, repeated],
    }, 'session-recovery', 'continue');

    expect(plan.resources).toHaveLength(1);
    expect(plan.resources[0]).toMatchObject({ replayRef: 'F001', name: 'result.png' });
    expect(plan.message).toContain('Agent artifacts: F001 — result.png');
    expect(plan.message).toContain('User attachments: F001 — reused.png');
  });

  it('preserves all distinct resources in deterministic history order without internal locations', () => {
    const plan = buildCanvasReplayPlan({
      interactions: [
        { id: 'interaction-1', user: 'one', assistant: 'answer one' },
        { id: 'interaction-2', user: 'two', assistant: 'answer two' },
      ],
      resources: [
        resource(),
        resource({
          id: 'interaction-2:artifact:0',
          sourceInteractionId: 'interaction-2',
          name: 'second.png',
          uri: `/api/canvas/artifacts/canvas-1/interaction-2/${'b'.repeat(40)}`,
        }),
      ],
    }, 'canonical-replay', 'alternative');

    expect(plan.resources.map((item) => item.replayRef)).toEqual(['F001', 'F002']);
    expect(plan.message).toContain('Agent artifacts: F001 — result.png');
    expect(plan.message).toContain('Agent artifacts: F002 — second.png');
    expect(plan.message).not.toContain('/api/canvas/');
    expect(plan.message).not.toContain('sourceInteractionId');
    expect(plan.message).not.toContain('canvas-context-resources');
    expect(plan.message.endsWith('\n\nalternative')).toBe(true);
  });

  it('does not merge different bytes merely because legacy Artifact IDs match', () => {
    const plan = buildCanvasReplayPlan({
      interactions: [
        { id: 'interaction-1', user: 'one', assistant: 'answer one' },
        { id: 'interaction-2', user: 'two', assistant: 'answer two' },
      ],
      resources: [
        resource({ contentHash: '1'.repeat(64) }),
        resource({
          id: 'interaction-2:artifact:0',
          sourceInteractionId: 'interaction-2',
          name: 'updated.png',
          contentHash: '2'.repeat(64),
        }),
      ],
    }, 'session-recovery', 'continue');

    expect(plan.resources.map((item) => item.replayRef)).toEqual(['F001', 'F002']);
  });
});
