import { describe, expect, it } from 'vitest';
import {
  publicCanvasAttachment,
  publicCanvasInteraction,
  publicCanvasSendReservation,
} from './canvas-public-dto.js';
import type { InteractionRecord, SendReservation } from './canvas-db.js';

describe('Canvas public DTO mapping', () => {
  it('projects safe attachment fields without content identity or source locations', () => {
    const attachment = publicCanvasAttachment({
      id: 'a'.repeat(40),
      contentHash: 'f'.repeat(64),
      name: 'source.png',
      mimeType: 'image/png',
      sizeBytes: 100,
      uri: `/api/canvas/attachments/canvas-1/${'a'.repeat(40)}`,
      sourceUri: '/private/source.png',
      storage: 'canvas',
      available: true,
    });
    expect(attachment).toMatchObject({
      id: 'a'.repeat(40),
      name: 'source.png',
      uri: `/api/canvas/attachments/canvas-1/${'a'.repeat(40)}`,
    });
    expect(attachment).not.toHaveProperty('contentHash');
    expect(attachment).not.toHaveProperty('sourceUri');
    expect(attachment.thumbnailUri).toContain('/thumbnail');
  });

  it('builds Send Operation output explicitly and never leaks its delivery plan', () => {
    const operation: SendReservation = {
      id: 'operation-1',
      branchId: 'branch-1',
      expectedHeadInteractionId: null,
      userInput: 'hello',
      attachments: [],
      materialization: 'canonical-replay',
      conversationId: 'agent:main:canvas:branch-1',
      outgoingMessage: '<canvas-context-snapshot>internal</canvas-context-snapshot>',
      snapshotVersion: 2,
      bootstrapResources: [{
        id: 'resource-1',
        sourceInteractionId: 'interaction-1',
        source: 'agent_artifact',
        name: 'result.png',
        mimeType: 'image/png',
        uri: '/private/resource',
        available: true,
      }],
      status: 'prepared',
      dispatchState: 'reserved',
      attemptCount: 0,
      lastAttemptAt: null,
      nextAttemptAt: null,
      error: null,
      interactionId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const publicOperation = publicCanvasSendReservation(operation);
    expect(publicOperation).toMatchObject({
      id: 'operation-1',
      materialization: 'canonical-replay',
      snapshotVersion: 2,
    });
    expect(publicOperation).not.toHaveProperty('outgoingMessage');
    expect(publicOperation).not.toHaveProperty('bootstrapResources');
  });

  it('does not expose opaque Backend handles through the legacy Interaction DTO', () => {
    const interaction: InteractionRecord = {
      id: 'interaction-1',
      version: 1,
      branchId: 'branch-1',
      parentInteractionId: null,
      backendTurnId: 'run-1',
      turnRef: { backendId: 'openclaw', schemaVersion: 1, opaque: { backendTurnId: 'run-1' } },
      userInput: 'hello',
      agentOutput: 'done',
      status: 'completed',
      executionState: 'completed',
      artifactSyncState: 'synced',
      terminalAt: 2,
      error: null,
      attachments: [],
      artifacts: [],
      approvals: [],
      executionMetadata: {},
      contextSnapshot: null,
      createdAt: 1,
      updatedAt: 2,
    };
    expect(publicCanvasInteraction(interaction)).not.toHaveProperty('turnRef');
  });
});
