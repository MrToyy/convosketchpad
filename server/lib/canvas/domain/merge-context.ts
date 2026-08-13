import type { CanvasContextResource } from './send-policy.js';
import type {
  CanvasInputDocument,
  CanvasResourceReferenceSnapshot,
} from './input-document.js';

export interface MergeContextInteraction {
  id: string;
  branchId: string;
  createdAt: number;
  user: string;
  assistant: string;
  inputDocument?: CanvasInputDocument;
  resourceReferences?: CanvasResourceReferenceSnapshot[];
}

export interface MergeContextSnapshot {
  version: 1;
  sources: Array<{
    mergeSourceId: string;
    sourceInteractionId: string;
    sourceBranchId: string;
    sourceCreatedAt: number;
    sourceUserInput: string;
    ordinal: number;
    path: Array<{
      interactionId: string;
      marker: string;
      resident: boolean;
    }>;
  }>;
  interactions: Array<MergeContextInteraction & { marker: string }>;
  resources: CanvasContextResource[];
}
