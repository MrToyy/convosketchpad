export interface CanvasChangedSignal {
  kind: 'changed';
  ownerId: string;
  canvasId: string;
}

export interface CanvasPreviewSignal {
  kind: 'preview';
  ownerId: string;
  canvasId: string;
  interactionId: string;
  text: string;
}

export type CanvasSyncSignal = CanvasChangedSignal | CanvasPreviewSignal;

type Subscriber = (signal: CanvasSyncSignal) => void;
const subscribers = new Set<Subscriber>();

export function publishCanvasChanged(ownerId: string, canvasId: string): void {
  const signal: CanvasChangedSignal = { kind: 'changed', ownerId, canvasId };
  for (const subscriber of subscribers) subscriber(signal);
}

export function publishCanvasPreview(input: Omit<CanvasPreviewSignal, 'kind'>): void {
  const signal: CanvasPreviewSignal = { kind: 'preview', ...input };
  for (const subscriber of subscribers) subscriber(signal);
}

export function subscribeCanvasSync(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}
