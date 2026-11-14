import { describe, expect, it } from 'vitest';
import { reasonMessage, splitDiagnosticReference, userFacingErrorMessage } from './user-facing-error';

describe('user-facing errors', () => {
  it('drops the IPC channel wrapper and repeated error prefixes', () => {
    expect(
      userFacingErrorMessage(
        "Error invoking remote method 'projects:recently-deleted': Error: Unsafe journal token path; recovery data was preserved.",
      ),
    ).toBe('Unsafe journal token path; recovery data was preserved.');
    expect(userFacingErrorMessage('Error. Clipboard unavailable')).toBe('Clipboard unavailable');
    expect(userFacingErrorMessage('Errorless settings name')).toBe('Errorless settings name');
  });

  it('separates a trailing diagnostic reference from the instruction', () => {
    const reference = 'cb5395dd-a8a6-415b-92eb-64a0d71dd2d1';
    expect(
      splitDiagnosticReference(
        `The clipboard does not contain an image. Copy a screenshot and try again. [Diagnostic reference: ${reference}]`,
      ),
    ).toEqual({
      text: 'The clipboard does not contain an image. Copy a screenshot and try again.',
      reference,
    });
    expect(splitDiagnosticReference('Mentions [Diagnostic reference: x] mid-sentence.')).toEqual({
      text: 'Mentions [Diagnostic reference: x] mid-sentence.',
    });
  });

  it('uses the caller’s fallback when nothing readable remains', () => {
    expect(
      reasonMessage(new Error("Error invoking remote method 'search:run': Error: "), 'Search failed.'),
    ).toBe('Search failed.');
    expect(reasonMessage('not an error', 'Search failed.')).toBe('Search failed.');
  });
});
