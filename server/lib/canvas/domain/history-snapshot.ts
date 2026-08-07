import type {
  CanonicalCanvasSnapshot,
  CanvasContextResource,
} from './send-policy.js';

interface HistoryAttachment {
  contentHash?: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  uri?: string;
  available?: boolean;
  warning?: string;
}

interface HistoryArtifact {
  contentHash?: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  uri: string;
  available?: boolean;
  warning?: string;
}

export interface CanvasHistoryEntry {
  id: string;
  user: string;
  assistant: string;
  attachments: HistoryAttachment[];
  artifacts: HistoryArtifact[];
}

function reusableContextResourceUri(uri: string): boolean {
  return uri.startsWith('/api/canvas/')
    || uri.startsWith('data:')
    || /^https?:\/\//i.test(uri);
}

export function assembleCanonicalCanvasSnapshot(
  history: CanvasHistoryEntry[],
): CanonicalCanvasSnapshot {
  const resources: CanvasContextResource[] = [];
  const addResource = (resource: CanvasContextResource) => {
    if (!resource.available || !reusableContextResourceUri(resource.uri)) return;
    resources.push(resource);
  };
  for (const entry of history) {
    entry.attachments.forEach((attachment, index) => {
      if (!attachment.uri) return;
      addResource({
        id: `${entry.id}:attachment:${index}`,
        ...(attachment.contentHash ? { contentHash: attachment.contentHash } : {}),
        sourceInteractionId: entry.id,
        source: 'user_attachment',
        name: attachment.name,
        mimeType: attachment.mimeType || 'application/octet-stream',
        sizeBytes: attachment.sizeBytes,
        uri: attachment.uri,
        available: attachment.available !== false,
        ...(attachment.warning ? { warning: attachment.warning } : {}),
      });
    });
    entry.artifacts.forEach((artifact, index) => {
      addResource({
        id: `${entry.id}:artifact:${index}`,
        ...(artifact.contentHash ? { contentHash: artifact.contentHash } : {}),
        sourceInteractionId: entry.id,
        source: 'agent_artifact',
        name: artifact.name,
        mimeType: artifact.mimeType || 'application/octet-stream',
        sizeBytes: artifact.sizeBytes,
        uri: artifact.uri,
        available: artifact.available !== false,
        ...(artifact.warning ? { warning: artifact.warning } : {}),
      });
    });
  }
  return {
    version: 2,
    interactions: history.map((entry) => ({
      id: entry.id,
      user: entry.user,
      assistant: entry.assistant,
    })),
    resources,
  };
}
