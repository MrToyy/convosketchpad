import { describe, expect, it, vi } from 'vitest';
import { createClientId } from './client-id';

describe('createClientId', () => {
  it('uses crypto.randomUUID when the browser exposes it', () => {
    const randomUUID = vi.fn(() => '5dc85786-745b-4ba1-95f1-592394e7cf2a');
    const getRandomValues = vi.fn();

    expect(createClientId({ randomUUID, getRandomValues } as unknown as Crypto)).toBe(
      '5dc85786-745b-4ba1-95f1-592394e7cf2a',
    );
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('creates a UUID with getRandomValues on non-secure HTTP origins', () => {
    const getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array) {
        array.forEach((_, index) => { array[index] = index; });
      }
      return array;
    };

    expect(createClientId({ getRandomValues })).toBe(
      '00010203-0405-4607-8809-0a0b0c0d0e0f',
    );
  });
});
