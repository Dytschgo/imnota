import { describe, expect, it } from 'vitest';
import {
  cancelledFailure,
  estimatedBytes,
  failure,
  publicError,
  selectionNumber,
  throwIfAborted,
} from './prompt-export-controller-helpers';

describe('prompt export controller helpers', () => {
  it('keeps controller failure details and classifies other errors', () => {
    expect(publicError(failure('native-failure', 'Clipboard busy', false, true))).toEqual({
      code: 'native-failure',
      message: 'Clipboard busy',
      retryable: false,
      fallbackAvailable: true,
      nativeCode: undefined,
    });
    expect(publicError(new Error('Bundle 2 is above the safe renderer limit.'))).toMatchObject({
      code: 'render-limit',
      retryable: true,
    });
    expect(publicError(new Error('  disk full  '))).toEqual({
      code: 'unexpected',
      message: 'disk full',
      retryable: true,
      fallbackAvailable: false,
    });
    expect(publicError('not an error').message).toBe('Prompt export failed unexpectedly. Try again.');
  });

  it('reports cancellation only after the signal aborts', () => {
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow(cancelledFailure().message);
    expect(publicError(cancelledFailure()).code).toBe('cancelled');
  });

  it('estimates decoded bytes and resolves bundle selections', () => {
    expect(estimatedBytes(undefined)).toBeUndefined();
    expect(estimatedBytes(4)).toBe(3);
    expect(estimatedBytes(-8)).toBe(0);
    expect(selectionNumber(3)).toBe(3);
    expect(selectionNumber({ bundleNumber: 2 } as Parameters<typeof selectionNumber>[0])).toBe(2);
    expect(selectionNumber()).toBeUndefined();
  });
});
