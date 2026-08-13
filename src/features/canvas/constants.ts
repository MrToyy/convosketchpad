import type { CanvasDraft } from './types';
import { EMPTY_INPUT_DOCUMENT } from './input-document';

export const MAX_TURN_MATERIALS = 9;

export const EMPTY_CANVAS_DRAFT: CanvasDraft = {
  agentRef: null,
  text: '',
  inputDocument: EMPTY_INPUT_DOCUMENT,
  files: [],
  fileKeys: [],
  persistedAttachments: [],
  previews: {},
  sending: false,
  error: null,
};
