import { describe, expect, it } from 'vitest';
import {
  cancelledFailure,
  estimatedBytes,
  failure,
  nativeFailure,
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
      technicalDetails: undefined,
    });
    expect(publicError(new Error('Bundle 2 is above the safe renderer limit.'))).toMatchObject({
      code: 'render-limit',
      retryable: true,
    });
    expect(publicError(new Error('  disk full at P:/private/project  '))).toEqual({
      code: 'unexpected',
      message: 'Prompt export failed unexpectedly. Try rebuilding the bundles.',
      retryable: true,
      fallbackAvailable: false,
      technicalDetails: 'disk full at P:/private/project',
    });
    expect(publicError('not an error').message).toBe(
      'Prompt export failed unexpectedly. Try rebuilding the bundles.',
    );
  });

  it('reports cancellation only after the signal aborts', () => {
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow(cancelledFailure().message);
    expect(publicError(cancelledFailure()).code).toBe('cancelled');
  });

  it('keeps native paths in optional details and gives a recovery step in the alert', () => {
    expect(
      nativeFailure({ code: 'io-failure', message: 'ENOENT P:/private/export.png', retryable: true }).detail,
    ).toMatchObject({
      message: 'An export file is missing. Rebuild the bundles to create a new copy.',
      technicalDetails: 'ENOENT P:/private/export.png',
    });
    expect(
      nativeFailure({ code: 'io-failure', message: 'EACCES P:/private/export', retryable: true }).detail,
    ).toMatchObject({
      code: 'native-failure',
      message: expect.stringMatching(/Check available space and folder access/i),
      technicalDetails: 'EACCES P:/private/export',
    });
    expect(
      nativeFailure({ code: 'session-not-found', message: 'Missing P:/private/export', retryable: true })
        .detail.message,
    ).toMatch(/Rebuild the bundles/i);
  });

  it('estimates decoded bytes and resolves bundle selections', () => {
    expect(estimatedBytes(undefined)).toBeUndefined();
    expect(estimatedBytes(undefined, 'text')).toBeUndefined();
    expect(estimatedBytes(4)).toBe(3);
    expect(estimatedBytes(-8)).toBe(0);
    expect(estimatedBytes(0, 'é')).toBe(2);
    expect(estimatedBytes(4, 'é')).toBe(5);
    expect(selectionNumber(3)).toBe(3);
    expect(selectionNumber({ bundleNumber: 2 } as Parameters<typeof selectionNumber>[0])).toBe(2);
    expect(selectionNumber()).toBeUndefined();
  });
});
