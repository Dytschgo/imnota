// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { legacyProjectSchema } from '../schema';
import { EMPTY_NOTES, emptyProject } from '../utils';
import { normalizeRecoveredProject } from '../../../electron/recovery';

describe('legacy recovery normalization', () => {
  it('restores v2 description, notes, title, priority and inclusion through trusted v3 paths', () => {
    const current = emptyProject('Recovered', '');
    current.screenshots = [
      {
        collectionId: current.collections[0].id,
        id: 'shot',
        originalFilename: 'screen.png',
        storedFilename: '001-screen.png',
        title: 'Saved title',
        description: 'Saved description',
        position: 0,
        createdAt: 'created',
        updatedAt: 'saved',
        priority: 'low',
        annotationFile: 'collections/001-collection/annotations/001-screen.png.json',
        descriptionFile: 'collections/001-collection/descriptions/001-screen.png.md',
        originalWidth: 10,
        originalHeight: 10,
        includeInExport: true,
      },
    ];
    const recovered = legacyProjectSchema.parse({
      schemaVersion: 2,
      rounds: [{ id: '001-first-feedback', name: 'Old', archived: false, createdAt: 'created' }],
      id: current.id,
      name: current.name,
      description: '',
      createdAt: 'created',
      updatedAt: 'recovered',
      status: 'active',
      tags: [],
      favourite: false,
      screenshots: [
        {
          roundId: '001-first-feedback',
          id: 'shot',
          originalFilename: 'untrusted.png',
          storedFilename: 'untrusted.png',
          title: 'Unsaved title',
          description: 'Unsaved description',
          position: 0,
          createdAt: 'created',
          updatedAt: 'recovered',
          tags: [],
          priority: 'critical',
          status: 'ready',
          annotationFile: 'rounds/001-first-feedback/annotations/untrusted.png.json',
          notesFile: 'rounds/001-first-feedback/notes/untrusted.png.md',
          originalWidth: 10,
          originalHeight: 10,
          includeInExport: false,
        },
      ],
      exportPreferences: {
        includeOriginalScreenshots: false,
        includeAnnotationMetadata: true,
        includedFields: [],
        overallInstructions: '',
        desiredOutcome: '',
        technicalConstraints: '',
        template: 'default',
      },
    });
    const result = normalizeRecoveredProject(current, recovered, {
      shot: { ...EMPTY_NOTES, problem: 'Unsaved structured note' },
    });
    expect(result.screenshots[0]).toMatchObject({
      title: 'Unsaved title',
      priority: 'high',
      includeInExport: false,
      storedFilename: '001-screen.png',
      collectionId: '001-collection',
    });
    expect(result.screenshots[0].description).toContain('Unsaved description');
    expect(result.screenshots[0].description).toContain('Unsaved structured note');
    expect(result.screenshots[0].annotationFile).toBe(current.screenshots[0].annotationFile);
  });
});
