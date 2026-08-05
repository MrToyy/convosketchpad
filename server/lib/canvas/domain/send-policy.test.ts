import { describe, expect, it } from 'vitest';
import {
  CanvasDomainError,
  decideCanvasSendPlan,
  type CanvasSendBranchState,
} from './send-policy.js';

const rootDraft: CanvasSendBranchState = {
  kind: 'root',
  conversationState: 'draft',
  headInteractionId: null,
  conversationIntegrity: 'unknown',
};

describe('Canvas send plan decision', () => {
  it('distinguishes lazy root, canonical fork replay, and existing continuation', () => {
    expect(decideCanvasSendPlan({ branch: rootDraft })).toEqual({
      materialization: 'lazy-root',
      expectedHeadInteractionId: null,
      requiresCanonicalSnapshot: false,
    });
    expect(decideCanvasSendPlan({
      branch: { ...rootDraft, kind: 'fork' },
    })).toMatchObject({
      materialization: 'canonical-replay',
      replayReason: 'canonical-replay',
      requiresCanonicalSnapshot: true,
    });
    expect(decideCanvasSendPlan({
      branch: {
        ...rootDraft,
        conversationState: 'active',
        headInteractionId: 'interaction-1',
        conversationIntegrity: 'healthy',
      },
      expectedHeadInteractionId: 'interaction-1',
    })).toMatchObject({
      materialization: 'continue-existing',
      expectedHeadInteractionId: 'interaction-1',
      requiresCanonicalSnapshot: false,
    });
  });

  it('uses the same canonical recovery path for drift and proactive reset', () => {
    const active: CanvasSendBranchState = {
      ...rootDraft,
      conversationState: 'active',
      headInteractionId: 'interaction-1',
      conversationIntegrity: 'drifted',
    };
    expect(decideCanvasSendPlan({
      branch: active,
      expectedHeadInteractionId: 'interaction-1',
    })).toMatchObject({
      materialization: 'session-recovery',
      replayReason: 'session-recovery',
    });
    expect(decideCanvasSendPlan({
      branch: { ...active, conversationIntegrity: 'healthy' },
      expectedHeadInteractionId: 'interaction-1',
      forceSessionRecovery: true,
    })).toMatchObject({ materialization: 'session-recovery' });
  });

  it('rejects stale or structurally invalid transitions with a stable code', () => {
    expect(() => decideCanvasSendPlan({
      branch: {
        ...rootDraft,
        conversationState: 'active',
        headInteractionId: 'interaction-1',
      },
      expectedHeadInteractionId: 'stale',
    })).toThrow(CanvasDomainError);
    try {
      decideCanvasSendPlan({
        branch: {
          ...rootDraft,
          conversationState: 'active',
          headInteractionId: 'interaction-1',
        },
        expectedHeadInteractionId: 'stale',
      });
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_branch_transition' });
    }
  });
});
