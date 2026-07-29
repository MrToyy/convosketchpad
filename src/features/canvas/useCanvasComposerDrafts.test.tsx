import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasComposerDrafts } from './useCanvasComposerDrafts';
import type { SendReservation } from './types';

function operation(overrides: Partial<SendReservation> = {}): SendReservation {
  return {
    id: 'operation-1',
    branchId: 'branch-1',
    expectedHeadInteractionId: null,
    userInput: 'hello',
    attachments: [],
    materialization: 'lazy-root',
    sessionKey: 'agent:main:canvas:branch-1',
    status: 'prepared',
    dispatchState: 'reserved',
    attemptCount: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    error: null,
    interactionId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn(),
  });
});

describe('useCanvasComposerDrafts', () => {
  it('clears a queued draft only after its operation is acknowledged', () => {
    const { result } = renderHook(() => useCanvasComposerDrafts());
    const file = new File(['image'], 'source.png', { type: 'image/png' });
    act(() => {
      result.current.updateDraft('branch-1', (draft) => ({ ...draft, text: 'hello' }));
      result.current.addFiles('branch-1', [file]);
      result.current.markSending('branch-1');
      result.current.trackOperation('branch-1', 'operation-1');
    });
    expect(result.current.drafts['branch-1']).toMatchObject({
      text: 'hello',
      sending: true,
    });

    act(() => {
      result.current.reconcileOperations([
        operation({
          status: 'acknowledged',
          dispatchState: 'acknowledged',
          interactionId: 'interaction-1',
        }),
      ], () => 'failed');
    });
    expect(result.current.drafts['branch-1']).toMatchObject({
      text: '',
      files: [],
      sending: false,
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('unlocks and preserves content when a queued operation fails', () => {
    const { result } = renderHook(() => useCanvasComposerDrafts());
    act(() => {
      result.current.updateDraft('branch-1', (draft) => ({ ...draft, text: 'retry me' }));
      result.current.trackOperation('branch-1', 'operation-1');
    });
    act(() => {
      result.current.reconcileOperations([
        operation({
          status: 'failed',
          dispatchState: 'failed',
          error: 'Gateway rejected the send',
        }),
      ], () => 'localized failure');
    });
    expect(result.current.drafts['branch-1']).toMatchObject({
      text: 'retry me',
      sending: false,
      error: 'localized failure',
    });
    expect(result.current.trackedOperations).toEqual({});
  });

  it('hydrates a refreshed failed send with persisted attachment references', () => {
    const { result } = renderHook(() => useCanvasComposerDrafts());
    act(() => {
      result.current.hydrateFailedSends([
        operation({
          status: 'failed',
          dispatchState: 'failed',
          error: 'Gateway rejected the send',
          attachments: [{
            id: 'a'.repeat(40),
            name: 'source.png',
            mimeType: 'image/png',
            sizeBytes: 10,
            uri: '/api/canvas/attachments/canvas-1/attachment-1',
            storage: 'canvas',
            available: true,
          }],
        }),
      ], () => 'localized failure');
    });
    expect(result.current.drafts['branch-1']).toMatchObject({
      text: 'hello',
      persistedAttachments: [expect.objectContaining({ name: 'source.png' })],
      sending: false,
      error: 'localized failure',
    });
  });
});
