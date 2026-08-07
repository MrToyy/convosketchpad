import { randomUUID } from 'node:crypto';

export interface ProductRuntimeEvent {
  id: string;
  type: string;
  ownerId?: string;
  canvasId?: string;
  branchId?: string;
  interactionId?: string;
  payload?: Record<string, unknown>;
  createdAt: number;
}

type Subscriber = (event: ProductRuntimeEvent) => void;
const subscribers = new Set<Subscriber>();

export function publishRuntimeEvent(
  event: Omit<ProductRuntimeEvent, 'id' | 'createdAt'>,
): ProductRuntimeEvent {
  const published = { ...event, id: randomUUID(), createdAt: Date.now() };
  for (const subscriber of subscribers) {
    try {
      subscriber(published);
    } catch (error) {
      subscribers.delete(subscriber);
      console.warn(
        '[runtime-status-events] Removed failed subscriber:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return published;
}

export function subscribeRuntimeEvents(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}
