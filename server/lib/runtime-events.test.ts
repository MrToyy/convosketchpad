import { describe, expect, it, vi } from 'vitest';
import {
  publishRuntimeEvent,
  subscribeRuntimeEvents,
} from './runtime-events.js';

describe('product runtime events', () => {
  it('publishes backend Gateway connection changes', () => {
    const subscriber = vi.fn();
    const unsubscribe = subscribeRuntimeEvents(subscriber);

    publishRuntimeEvent({ type: 'runtime.connection_changed', payload: { state: 'connected' } });

    expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({
      type: 'runtime.connection_changed',
      payload: { state: 'connected' },
    }));
    unsubscribe();
  });

  it('stops delivering events after unsubscribe', () => {
    const subscriber = vi.fn();
    const unsubscribe = subscribeRuntimeEvents(subscriber);
    unsubscribe();

    publishRuntimeEvent({ type: 'runtime.connection_changed' });

    expect(subscriber).not.toHaveBeenCalled();
  });

  it('isolates and removes a failed subscriber', () => {
    const failed = vi.fn(() => {
      throw new Error('stream closed');
    });
    const healthy = vi.fn();
    subscribeRuntimeEvents(failed);
    const unsubscribeHealthy = subscribeRuntimeEvents(healthy);

    expect(() => publishRuntimeEvent({ type: 'runtime.connection_changed' })).not.toThrow();
    publishRuntimeEvent({ type: 'runtime.connection_changed' });

    expect(failed).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(2);
    unsubscribeHealthy();
  });
});
