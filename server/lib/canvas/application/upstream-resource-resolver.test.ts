import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { testConversationHandleFactory } from '../../fixtures/test-conversation-handle.js';
import { CanvasStore } from '../persistence/canvas-store.js';
import { UpstreamResourceResolver } from './upstream-resource-resolver.js';

const cleanup: Array<() => void> = [];

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'canvas-upstream-resolver-'));
  const store = new CanvasStore(path.join(directory, 'canvas.sqlite'), {
    createConversationHandle: testConversationHandleFactory,
  });
  cleanup.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  store.ensureUser('owner-a', 'Owner A');
  const canvas = store.createCanvas('owner-a', 'Canvas', { runtimeId: 'openclaw', profileId: 'main' });
  return { store, canvas };
}

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

describe('UpstreamResourceResolver', () => {
  it('allows a root composer to reference a current attachment', () => {
    const { store, canvas } = fixture();
    const branch = store.createRootBranch('owner-a', canvas.id);
    const attachment = store.recordCanvasAttachment('owner-a', canvas.id, {
      id: 'a'.repeat(40),
      contentHash: 'a'.repeat(64),
      name: 'root.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      uri: `/api/canvas/attachments/${canvas.id}/${'a'.repeat(40)}`,
      storage: 'canvas',
      available: true,
    });
    const result = new UpstreamResourceResolver(store).resolveDocument({
      ownerId: 'owner-a',
      branchId: branch.id,
      currentAttachments: [attachment],
      document: {
        version: 1,
        segments: [{ type: 'text', text: 'inspect ' }, { type: 'resource', key: 'root-file' }],
        references: [{
          key: 'root-file',
          origin: 'current_turn_attachment',
          attachmentId: attachment.id!,
        }],
      },
    });
    expect(result.userInput).toBe('inspect @[root.png]');
    expect(result.references[0]).toMatchObject({
      origin: 'current_turn_attachment',
      sourceInteractionId: null,
      resourceId: attachment.id,
    });
    expect(new UpstreamResourceResolver(store).listResources('owner-a', branch.id)).toEqual([]);
  });

  it('exposes only the selected branch parent chain', () => {
    const { store, canvas } = fixture();
    const firstBranch = store.createRootBranch('owner-a', canvas.id);
    const upstreamAttachment = store.recordCanvasAttachment('owner-a', canvas.id, {
      id: 'b'.repeat(40), name: 'upstream.pdf', mimeType: 'application/pdf', sizeBytes: 12,
      uri: `/api/canvas/attachments/${canvas.id}/${'b'.repeat(40)}`, storage: 'canvas', available: true,
    });
    const firstReservation = store.prepareSend('owner-a', {
      branchId: firstBranch.id, userInput: 'first', attachments: [upstreamAttachment],
    });
    const first = store.acknowledgeSend('owner-a', firstReservation.id, 'turn-1');

    const siblingBranch = store.createRootBranch('owner-a', canvas.id);
    const siblingAttachment = store.recordCanvasAttachment('owner-a', canvas.id, {
      id: 'c'.repeat(40), name: 'sibling.pdf', mimeType: 'application/pdf', sizeBytes: 12,
      uri: `/api/canvas/attachments/${canvas.id}/${'c'.repeat(40)}`, storage: 'canvas', available: true,
    });
    const siblingReservation = store.prepareSend('owner-a', {
      branchId: siblingBranch.id, userInput: 'sibling', attachments: [siblingAttachment],
    });
    const sibling = store.acknowledgeSend('owner-a', siblingReservation.id, 'turn-2');

    const resources = new UpstreamResourceResolver(store).listResources('owner-a', firstBranch.id);
    expect(resources.map((item) => item.name)).toEqual(['upstream.pdf']);
    expect(() => new UpstreamResourceResolver(store).resolveDocument({
      ownerId: 'owner-a',
      branchId: firstBranch.id,
      currentAttachments: [],
      document: {
        version: 1,
        segments: [{ type: 'resource', key: 'forged' }],
        references: [{
          key: 'forged',
          origin: 'upstream',
          kind: 'canvas_attachment',
          sourceInteractionId: sibling.id,
          resourceId: siblingAttachment.id!,
        }],
      },
    })).toThrow('resource_reference_unavailable');
    expect(first.id).not.toBe(sibling.id);
  });
});
