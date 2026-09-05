import type { NoteFields } from '../../shared/types';
import { TextArea } from './ui';

const previousNoteLabels: Record<Exclude<keyof NoteFields, 'problem'>, string> = {
  summary: 'Summary',
  observation: 'Observation',
  expectedBehaviour: 'Expected behaviour',
  requestedChange: 'Requested change',
  technicalDetails: 'Technical details',
  aiInstruction: 'AI instruction',
  additionalNotes: 'Additional notes',
};

type PreviousNote = { label: string; value: string };

export function ProblemDescriptionEditor({
  notes,
  description,
  onChange,
}: {
  notes: NoteFields;
  description: string;
  onChange: (notes: NoteFields) => void;
}) {
  const previousNotes: PreviousNote[] = [
    ...Object.entries(previousNoteLabels)
      .map(([key, label]) => ({ label, value: notes[key as Exclude<keyof NoteFields, 'problem'>] }))
      .filter(({ value }) => value.trim()),
    ...(description.trim() ? [{ label: 'Description', value: description }] : []),
  ];

  return (
    <div className="note-section">
      <TextArea
        label="Problem description"
        rows={4}
        placeholder="Describe the problem in this screenshot"
        value={notes.problem}
        onChange={(event) => onChange({ ...notes, problem: event.target.value })}
      />
      {previousNotes.length > 0 && (
        <details className="previous-notes">
          <summary>Previous notes</summary>
          <p>Previous notes are preserved. Existing export preferences still apply.</p>
          <dl>
            {previousNotes.map(({ label, value }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
