import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_CANVAS_DRAFT, MAX_CANVAS_ATTACHMENTS } from './constants';
import type { CanvasDraft, SendReservation } from './types';

function revokeDraftPreviews(draft: CanvasDraft | undefined): void {
  if (!draft) return;
  Object.values(draft.previews).forEach((url) => URL.revokeObjectURL(url));
}

export function useCanvasComposerDrafts() {
  const [drafts, setDrafts] = useState<Record<string, CanvasDraft>>({});
  const [trackedOperations, setTrackedOperations] = useState<Record<string, string>>({});
  const draftsRef = useRef(drafts);
  const trackedOperationsRef = useRef(trackedOperations);
  const hydratedFailedOperationIdsRef = useRef(new Set<string>());
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);
  useEffect(() => {
    trackedOperationsRef.current = trackedOperations;
  }, [trackedOperations]);

  useEffect(() => () => {
    Object.values(draftsRef.current).forEach(revokeDraftPreviews);
  }, []);

  const updateDraft = useCallback((
    branchId: string,
    update: (draft: CanvasDraft) => CanvasDraft,
  ) => {
    setDrafts((current) => ({
      ...current,
      [branchId]: update(current[branchId] || EMPTY_CANVAS_DRAFT),
    }));
  }, []);

  const addFiles = useCallback((branchId: string, incoming: File[]) => {
    updateDraft(branchId, (draft) => {
      const accepted = incoming.slice(
        0,
        MAX_CANVAS_ATTACHMENTS - draft.files.length - draft.persistedAttachments.length,
      );
      const previews = { ...draft.previews };
      accepted.filter((file) => file.type.startsWith('image/')).forEach((file) => {
        previews[`${file.name}-${file.lastModified}`] = URL.createObjectURL(file);
      });
      return {
        ...draft,
        files: [...draft.files, ...accepted],
        previews,
        error: null,
      };
    });
  }, [updateDraft]);

  const removePersistedAttachment = useCallback((branchId: string, index: number) => {
    updateDraft(branchId, (draft) => ({
      ...draft,
      persistedAttachments: draft.persistedAttachments.filter(
        (_, itemIndex) => itemIndex !== index,
      ),
    }));
  }, [updateDraft]);

  const removeFile = useCallback((branchId: string, index: number) => {
    updateDraft(branchId, (draft) => {
      const file = draft.files[index];
      const key = file ? `${file.name}-${file.lastModified}` : '';
      const previews = { ...draft.previews };
      if (key && previews[key]) {
        URL.revokeObjectURL(previews[key]);
        delete previews[key];
      }
      return {
        ...draft,
        files: draft.files.filter((_, itemIndex) => itemIndex !== index),
        previews,
      };
    });
  }, [updateDraft]);

  const clearDraft = useCallback((branchId: string) => {
    setDrafts((current) => {
      revokeDraftPreviews(current[branchId]);
      return { ...current, [branchId]: EMPTY_CANVAS_DRAFT };
    });
    setTrackedOperations((current) => {
      if (!(branchId in current)) return current;
      const next = { ...current };
      delete next[branchId];
      return next;
    });
  }, []);

  const markSending = useCallback((branchId: string) => {
    updateDraft(branchId, (current) => ({ ...current, sending: true, error: null }));
  }, [updateDraft]);

  const trackOperation = useCallback((branchId: string, operationId: string) => {
    setTrackedOperations((current) => ({ ...current, [branchId]: operationId }));
    updateDraft(branchId, (current) => ({ ...current, sending: true }));
  }, [updateDraft]);

  const markFailed = useCallback((branchId: string, error: string) => {
    setTrackedOperations((current) => {
      if (!(branchId in current)) return current;
      const next = { ...current };
      delete next[branchId];
      return next;
    });
    updateDraft(branchId, (current) => ({ ...current, sending: false, error }));
  }, [updateDraft]);

  const reconcileOperations = useCallback((
    operations: SendReservation[],
    errorMessage: (operation: SendReservation) => string,
  ) => {
    for (const operation of operations) {
      if (trackedOperationsRef.current[operation.branchId] !== operation.id) continue;
      if (operation.status === 'acknowledged') clearDraft(operation.branchId);
      else if (operation.status === 'failed') {
        markFailed(operation.branchId, errorMessage(operation));
      }
    }
  }, [clearDraft, markFailed]);

  const hydrateFailedSends = useCallback((
    operations: SendReservation[],
    errorMessage: (operation: SendReservation) => string,
  ) => {
    const fresh = operations.filter((operation) => {
      if (hydratedFailedOperationIdsRef.current.has(operation.id)) return false;
      hydratedFailedOperationIdsRef.current.add(operation.id);
      return true;
    });
    if (fresh.length === 0) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const operation of fresh) {
        const existing = next[operation.branchId];
        if (existing && (
          existing.text
          || existing.files.length > 0
          || existing.persistedAttachments.length > 0
        )) {
          next[operation.branchId] = {
            ...existing,
            sending: false,
            error: errorMessage(operation),
          };
          continue;
        }
        next[operation.branchId] = {
          ...EMPTY_CANVAS_DRAFT,
          text: operation.userInput,
          persistedAttachments: operation.attachments,
          error: errorMessage(operation),
        };
      }
      return next;
    });
  }, []);

  return {
    drafts,
    trackedOperations,
    updateDraft,
    addFiles,
    removeFile,
    removePersistedAttachment,
    clearDraft,
    markSending,
    trackOperation,
    markFailed,
    reconcileOperations,
    hydrateFailedSends,
  };
}
