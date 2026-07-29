export type CanvasResourceLocator =
  | {
    kind: 'canvas_attachment';
    canvasId: string;
    attachmentId: string;
  }
  | {
    kind: 'interaction_artifact';
    canvasId: string;
    interactionId: string;
    artifactId: string;
  }
  | {
    kind: 'inline_data';
    encoded: string;
  };

export function locateCanvasResource(uri: string): CanvasResourceLocator | null {
  const attachment = uri.match(/^\/api\/canvas\/attachments\/([^/]+)\/([^/]+)$/);
  if (attachment) {
    return {
      kind: 'canvas_attachment',
      canvasId: decodeURIComponent(attachment[1]),
      attachmentId: decodeURIComponent(attachment[2]),
    };
  }
  const artifact = uri.match(/^\/api\/canvas\/artifacts\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (artifact) {
    return {
      kind: 'interaction_artifact',
      canvasId: decodeURIComponent(artifact[1]),
      interactionId: decodeURIComponent(artifact[2]),
      artifactId: decodeURIComponent(artifact[3]),
    };
  }
  const data = uri.match(/^data:[^;,]+;base64,(.+)$/s);
  return data ? { kind: 'inline_data', encoded: data[1] } : null;
}
