import { describe, expect, it, vi } from 'vitest';
import {
  publishRuntimeEvent,
  subscribeRuntimeEvents,
} from './runtime-status-events.js';

describe('product runtime events', () => {
  it('publishes Agent Runtime status changes', () => {
    const subscriber = vi.fn();
    const unsubscribe = subscribeRuntimeEvents(subscriber);

    publishRuntimeEvent({ type: 'runtime.status_changed', payload: { overallState: 'ready' } });

    expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({
      type: 'runtime.status_changed',
      payload: { overallState: 'ready' },
    }));
    unsubscribe();
  });

  it('stops delivering events after unsubscribe', () => {
    const subscriber = vi.fn();
    const unsubscribe = subscribeRuntimeEvents(subscriber);
    unsubscribe();

    publishRuntimeEvent({ type: 'runtime.status_changed' });

    expect(subscriber).not.toHaveBeenCalled();
  });

  it('isolates and removes a failed subscriber', () => {
    const failed = vi.fn(() => {
      throw new Error('stream closed');
    });
    const healthy = vi.fn();
    subscribeRuntimeEvents(failed);
    const unsubscribeHealthy = subscribeRuntimeEvents(healthy);

    expect(() => publishRuntimeEvent({ type: 'runtime.status_changed' })).not.toThrow();
    publishRuntimeEvent({ type: 'runtime.status_changed' });

    expect(failed).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(2);
    unsubscribeHealthy();
  });
});
