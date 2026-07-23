export type UploadMode = 'inline' | 'file_reference';
export type UploadAttachmentOrigin = 'upload' | 'server_path';

export interface UploadAttachmentPolicy {
  forwardToSubagents: boolean;
}

export interface InlineUploadReference {
  encoding: 'base64';
  base64: string;
  base64Bytes: number;
  previewUrl?: string;
  compressed: boolean;
}

export type UploadPreparationOutcome =
  | 'inline_ready'
  | 'optimized_inline'
  | 'file_reference_ready'
  | 'downgraded_to_file_reference'
  | 'blocked_inline';

export interface UploadPreparationMetadata {
  sourceMode: UploadMode;
  finalMode: UploadMode;
  outcome: UploadPreparationOutcome;
  reason?: string;
  originalMimeType: string;
  originalSizeBytes: number;
  inlineBase64Bytes?: number;
  contextSafetyMaxBytes?: number;
  inlineTargetBytes?: number;
  inlineChosenWidth?: number;
  inlineChosenHeight?: number;
  inlineIterations?: number;
  inlineMinDimension?: number;
  inlineFallbackReason?: string;
  localPathAvailable?: boolean;
}

export interface FileUploadReference {
  kind: 'local_path';
  path: string;
  uri: string;
}

export interface UploadAttachmentDescriptor {
  id: string;
  origin: UploadAttachmentOrigin;
  mode: UploadMode;
  name: string;
  mimeType: string;
  sizeBytes: number;
  inline?: InlineUploadReference;
  reference?: FileUploadReference;
  preparation?: UploadPreparationMetadata;
  policy: UploadAttachmentPolicy;
}

export interface UploadManifestOptions {
  enabled: boolean;
  exposeInlineBase64ToAgent: boolean;
  allowSubagentForwarding: boolean;
}

export interface OutgoingUploadPayload {
  descriptors: UploadAttachmentDescriptor[];
  manifest: UploadManifestOptions;
}
