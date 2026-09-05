import type { Annotation, NoteFields, ProjectData, ScreenshotRecord } from './types.js';
import { annotationLabel } from './utils.js';

const fieldLabels: Record<keyof NoteFields, string> = {
  summary: 'Summary',
  observation: 'Observation',
  problem: 'Problem',
  expectedBehaviour: 'Expected Behaviour',
  requestedChange: 'Requested Change',
  technicalDetails: 'Technical Details',
  aiInstruction: 'AI Instruction',
  additionalNotes: 'Additional Notes',
};

function section(label: string, value: string | undefined): string {
  return value?.trim() ? `${label}:\n${value.trim()}\n` : '';
}

export function generateMarkdown(
  project: ProjectData,
  selected: ScreenshotRecord[],
  notes: Record<string, NoteFields>,
  annotations: Record<string, Annotation[]>,
): string {
  const p = project.exportPreferences;
  const out = [`# ${project.name}`, ''];
  if (p.desiredOutcome.trim()) out.push('## Objective', '', p.desiredOutcome.trim(), '');
  if (project.description.trim()) out.push('## Context', '', project.description.trim(), '');
  if (p.overallInstructions.trim())
    out.push('## Instructions for the AI Agent', '', p.overallInstructions.trim(), '');
  if (p.technicalConstraints.trim())
    out.push('## Technical Constraints', '', p.technicalConstraints.trim(), '');
  if (selected.length) {
    out.push('## Visual References', '');
    selected.forEach((shot, index) => {
      const note = notes[shot.id] ?? ({} as NoteFields);
      out.push(
        `### Screenshot ${index + 1}: ${shot.title || shot.originalFilename}`,
        '',
        `File: ${shot.storedFilename.replace(/\.[^.]+$/, '')}-annotated.png`,
        `Feedback round: ${project.rounds.find((round) => round.id === shot.roundId)?.name ?? 'First feedback'}`,
        '',
      );
      p.includedFields.forEach((key) => out.push(section(fieldLabels[key], note[key])));
      const anns = [...(annotations[shot.id] ?? [])].sort((a, b) => a.zIndex - b.zIndex);
      if (anns.length) out.push('Annotations:', ...anns.map((a) => `- ${annotationLabel(a)}`), '');
    });
  }
  if (p.desiredOutcome.trim()) out.push('## Definition of Done', '', p.desiredOutcome.trim(), '');
  out.push(
    '## Final Instruction',
    '',
    'Use the screenshots and notes as authoritative visual context. Preserve parts of the interface that are not explicitly marked for change. If a requirement is ambiguous, state the assumption before implementing it.',
    '',
  );
  return (
    out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}
