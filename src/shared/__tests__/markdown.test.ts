import { describe, expect, it } from 'vitest';
import { generateMarkdown } from '../markdown.js';
import { emptyProject } from '../utils.js';
import type { Annotation, NoteFields } from '../types.js';

const note: NoteFields = {
  summary: 'The form is hard to scan.',
  observation: '',
  problem: 'The error is below the fold.',
  expectedBehaviour: '',
  requestedChange: '',
  technicalDetails: '',
  aiInstruction: '',
  additionalNotes: '',
};
const annotation: Annotation = {
  id: 'a1',
  kind: 'step',
  x: 10,
  y: 20,
  width: 48,
  height: 48,
  stepNumber: 1,
  zIndex: 0,
};

describe('Markdown context generation', () => {
  it('keeps useful sections and removes empty fields', () => {
    const project = emptyProject('Checkout review', 'A local UI review');
    project.exportPreferences.desiredOutcome = 'Make the error impossible to miss.';
    project.screenshots = [
      {
        roundId: '001-first-feedback',
        id: 'shot1',
        originalFilename: 'screen.png',
        storedFilename: '001-screen.png',
        title: 'Error state',
        description: '',
        position: 0,
        createdAt: '',
        updatedAt: '',
        tags: [],
        priority: 'high',
        status: 'ready',
        annotationFile: 'annotations/001-screen.png.json',
        notesFile: 'notes/001-screen.png.md',
        originalWidth: 100,
        originalHeight: 100,
        includeInExport: true,
      },
    ];
    const markdown = generateMarkdown(project, project.screenshots, { shot1: note }, { shot1: [annotation] });
    expect(markdown).toContain('# Checkout review');
    expect(markdown).toContain('Summary:');
    expect(markdown).toContain('- Step 1');
    expect(markdown).not.toContain('Observation:');
    expect(markdown).not.toContain('## Instructions for the AI Agent');
  });
});
