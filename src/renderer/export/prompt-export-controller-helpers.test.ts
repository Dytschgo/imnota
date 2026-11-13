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
    const error = failure('native-failure', 'Clipboard busy', false, true);
    expect(publicError(error)).toBe(error.detail);
    // Renderer-authored guidance names the specific next step, so it stays the visible message.
    expect(error.detail).toMatchObject({
      message: 'Clipboard busy',
      recovery: 'retry',
      fallbackAvailable: true,
    });
    expect(error.detail.technicalDetails).toBeUndefined();
    expect(
      failure('content-changed', 'Picture 3 changed after export planning. Save and export again.').detail,
    ).toMatchObject({
      code: 'content-changed',
      message: 'Picture 3 changed after export planning. Save and export again.',
      recovery: 'rebuild',
    });
    expect(
      failure('native-failure', 'Use its saved PNG and Markdown files.', true, true, 'clipboard-limit')
        .detail,
    ).toMatchObject({
      nativeCode: 'clipboard-limit',
      message: 'Use its saved PNG and Markdown files.',
      recovery: 'use-files',
      fallbackAvailable: true,
    });
    expect(publicError(new Error('Bundle 2 is above the safe renderer limit.'))).toMatchObject({
      code: 'render-limit',
      retryable: false,
      recovery: 'fix-content',
    });
    expect(publicError(new Error('  disk full at P:/private/project  '))).toEqual({
      code: 'unexpected',
      recovery: 'rebuild',
      message: 'Prompt export could not finish. Rebuild bundles to try again.',
      retryable: true,
      fallbackAvailable: false,
      technicalDetails: 'disk full at P:/private/project',
    });
    expect(publicError('not an error').message).toBe(
      'Prompt export could not finish. Rebuild bundles to try again.',
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
      nativeFailure({
        code: 'io-failure',
        message: 'ENOENT P:/private/export.png',
        retryable: true,
        details: { errno: 'ENOENT' },
      }).detail,
    ).toMatchObject({
      message: 'An export file is missing. Rebuild bundles to create a new copy.',
      technicalDetails: 'ENOENT P:/private/export.png',
    });
    expect(
      nativeFailure({
        code: 'io-failure',
        message: 'EACCES P:/private/export',
        retryable: true,
        details: { errno: 'EACCES' },
      }).detail,
    ).toMatchObject({
      code: 'native-failure',
      message: expect.stringMatching(/export folder is not writable/i),
      technicalDetails: 'EACCES P:/private/export',
    });
    expect(
      nativeFailure({ code: 'session-not-found', message: 'Missing P:/private/export', retryable: true })
        .detail.message,
    ).toMatch(/Rebuild bundles/i);
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
