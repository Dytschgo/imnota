import { expect, it } from 'vitest';
import { ANNOTATION_UNDO_LIMIT, pushBounded } from './undo-history';

it('keeps the newest limit entries in order after pushing more than the limit', () => {
  let history: number[] = [];
  for (let entry = 0; entry < ANNOTATION_UNDO_LIMIT + 5; entry++) {
    history = pushBounded(history, entry, ANNOTATION_UNDO_LIMIT);
  }

  expect(history).toEqual(Array.from({ length: ANNOTATION_UNDO_LIMIT }, (_, index) => index + 5));
});
