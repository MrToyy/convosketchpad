import type { CanvasDraft } from './types';

export const MAX_CANVAS_ATTACHMENTS = 4;

export const EMPTY_CANVAS_DRAFT: CanvasDraft = {
  text: '',
  files: [],
  persistedAttachments: [],
  previews: {},
  sending: false,
  error: null,
};
