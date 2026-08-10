import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_CANVAS_DRAFT, MAX_TURN_MATERIALS } from './constants';
import type { CanvasDraft, SendReservation } from './types';
import {
  draftDocumentText,
  enrichInputDocument,
  removeDraftResource,
  upstreamReferenceCount,
} from './input-document';

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
        MAX_TURN_MATERIALS
          - draft.files.length
          - draft.persistedAttachments.length
          - upstreamReferenceCount(draft.inputDocument),
      );
      const previews = { ...draft.previews };
      const fileKeys = accepted.map(() => crypto.randomUUID());
      accepted.forEach((file, index) => {
        if (file.type.startsWith('image/')) previews[fileKeys[index]] = URL.createObjectURL(file);
      });
      return {
        ...draft,
        files: [...draft.files, ...accepted],
        fileKeys: [...draft.fileKeys, ...fileKeys],
        previews,
        error: null,
      };
    });
  }, [updateDraft]);

  const removePersistedAttachment = useCallback((branchId: string, index: number) => {
    updateDraft(branchId, (draft) => {
      const attachment = draft.persistedAttachments[index];
      const inputDocument = attachment
        ? removeDraftResource(draft.inputDocument, (reference) =>
          reference.origin === 'current_turn_attachment'
          && reference.attachmentId === attachment.id)
        : draft.inputDocument;
      return {
        ...draft,
        text: draftDocumentText(inputDocument),
        inputDocument,
        persistedAttachments: draft.persistedAttachments.filter(
          (_, itemIndex) => itemIndex !== index,
        ),
      };
    });
  }, [updateDraft]);

  const removeFile = useCallback((branchId: string, index: number) => {
    updateDraft(branchId, (draft) => {
      const key = draft.fileKeys[index] || '';
      const previews = { ...draft.previews };
      if (key && previews[key]) {
        URL.revokeObjectURL(previews[key]);
        delete previews[key];
      }
      const inputDocument = removeDraftResource(draft.inputDocument, (reference) =>
        reference.origin === 'draft_attachment' && reference.draftAttachmentKey === key);
      return {
        ...draft,
        text: draftDocumentText(inputDocument),
        inputDocument,
        files: draft.files.filter((_, itemIndex) => itemIndex !== index),
        fileKeys: draft.fileKeys.filter((_, itemIndex) => itemIndex !== index),
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
          || existing.inputDocument.segments.length > 0
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
          inputDocument: enrichInputDocument(
            operation.inputDocument,
            operation.resourceReferences,
            operation.userInput,
          ),
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
