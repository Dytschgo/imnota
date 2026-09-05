import { expect, it } from 'vitest';
import { noteToMarkdown, parseNotesMarkdown } from '../notes';
import { EMPTY_NOTES } from '../utils';

it('round-trips multiline feedback and Markdown headings', () => {
  const notes = {
    ...EMPTY_NOTES,
    summary: 'First line\nSecond line\n\n## Implementation\nKeep this section.',
    additionalNotes: '- One\n- Two',
  };
  expect(parseNotesMarkdown(noteToMarkdown(notes))).toEqual(notes);
});
