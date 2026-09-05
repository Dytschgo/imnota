import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { NoteFields } from '../../shared/types';
import { ProblemDescriptionEditor } from './ProblemDescriptionEditor';

afterEach(cleanup);

const notes: NoteFields = {
  summary: 'The summary',
  observation: 'The observation',
  problem: 'The current problem',
  expectedBehaviour: 'The expected behaviour',
  requestedChange: 'The requested change',
  technicalDetails: 'The technical details',
  aiInstruction: 'The AI instruction',
  additionalNotes: 'The additional notes',
};

it('renders one editable problem description textarea', () => {
  render(<ProblemDescriptionEditor notes={notes} description="" onChange={vi.fn()} />);

  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  expect(screen.getByRole('textbox', { name: 'Problem description' })).toHaveValue('The current problem');
});

it('preserves every other note field when the problem description changes', () => {
  const onChange = vi.fn();
  render(<ProblemDescriptionEditor notes={notes} description="" onChange={onChange} />);

  fireEvent.change(screen.getByRole('textbox', { name: 'Problem description' }), {
    target: { value: 'Updated problem' },
  });

  expect(onChange).toHaveBeenCalledWith({ ...notes, problem: 'Updated problem' });
});

it('shows non-empty old notes as collapsed, read-only plain text', () => {
  const legacyDescription = '<strong>Legacy description</strong>';
  render(
    <ProblemDescriptionEditor
      notes={{ ...notes, summary: '<em>Old summary</em>' }}
      description={legacyDescription}
      onChange={vi.fn()}
    />,
  );

  const details = screen.getByText('Previous notes').closest('details');
  expect(details).not.toHaveAttribute('open');
  expect(screen.getByText('Previous notes').tagName).toBe('SUMMARY');
  expect(
    screen.getByText('Previous notes are preserved. Existing export preferences still apply.'),
  ).toBeInTheDocument();
  expect(screen.getByText('<em>Old summary</em>')).toBeInTheDocument();
  expect(screen.getByText('<strong>Legacy description</strong>')).toBeInTheDocument();
  expect(details?.querySelectorAll('textarea, input, select')).toHaveLength(0);
  expect(details?.querySelector('em, strong')).toBeNull();
});

it('omits the previous-notes section when every old value is empty', () => {
  const emptyNotes: NoteFields = {
    summary: '',
    observation: '',
    problem: '',
    expectedBehaviour: '',
    requestedChange: '',
    technicalDetails: '',
    aiInstruction: '',
    additionalNotes: '',
  };
  render(<ProblemDescriptionEditor notes={emptyNotes} description="   " onChange={vi.fn()} />);

  expect(screen.queryByText('Previous notes')).not.toBeInTheDocument();
});
