import { describe, expect, it } from 'vitest';
import { orderedCollectionItems, type DrawingRecord, type TextBlockRecord } from '../content-items.js';
import { validateProject } from '../schema.js';
import { emptyProject } from '../utils.js';

function text(id: string, position: number): TextBlockRecord {
  return {
    id,
    collectionId: '001-collection',
    kind: 'text',
    position,
    includeInExport: true,
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    markdownFilename: `${id}.md`,
  };
}

function drawing(id: string, position: number): DrawingRecord {
  return {
    id,
    collectionId: '001-collection',
    kind: 'drawing',
    position,
    includeInExport: true,
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    title: 'Architecture',
    sourceFilename: `${id}.json`,
    imageFilename: `${id}.png`,
    originalWidth: 160,
    originalHeight: 120,
  };
}

describe('mixed content contract', () => {
  it('combines authoritative arrays in collection position order with a screenshot discriminator', () => {
    const project = emptyProject('Mixed', '');
    project.schemaVersion = 4;
    project.screenshots = [
      {
        collectionId: '001-collection',
        id: 'shot',
        originalFilename: 'screen.png',
        storedFilename: 'screen.png',
        title: 'Screen',
        description: '',
        position: 1,
        createdAt: '2026-09-07T00:00:00.000Z',
        updatedAt: '2026-09-07T00:00:00.000Z',
        priority: 'medium',
        annotationFile: 'collections/001-collection/annotations/screen.png.json',
        descriptionFile: 'collections/001-collection/descriptions/screen.png.md',
        originalWidth: 1,
        originalHeight: 1,
        includeInExport: true,
      },
    ];
    project.contentItems = [drawing('drawing_a', 2), text('text_a', 0)];
    const ordered = orderedCollectionItems(validateProject(project), '001-collection');
    expect(ordered.map((item) => [item.id, item.kind])).toEqual([
      ['text_a', 'text'],
      ['shot', 'screenshot'],
      ['drawing_a', 'drawing'],
    ]);
    expect(project.screenshots[0]).not.toHaveProperty('kind');
  });

  it('keeps version 3 data free of contentItems and accepts validated version 4 records', () => {
    const version3 = emptyProject('Existing', '');
    expect(validateProject(version3)).not.toHaveProperty('contentItems');
    const version4 = { ...version3, schemaVersion: 4 as const, contentItems: [text('text_a', 0)] };
    expect(validateProject(version4)).toMatchObject({ schemaVersion: 4, contentItems: [{ kind: 'text' }] });
  });

  it('rejects IDs, paths, and positions that alias across mixed records', () => {
    const project = {
      ...emptyProject('Invalid', ''),
      schemaVersion: 4 as const,
      contentItems: [text('same', 0), drawing('drawing_a', 0)],
    };
    expect(() => validateProject(project)).toThrow(/duplicate mixed-content positions/);
    project.contentItems = [text('same', 0), { ...text('other', 1), markdownFilename: 'same.md' }];
    expect(() => validateProject(project)).toThrow(/aliased storage paths/);
    project.screenshots = [
      {
        collectionId: '001-collection',
        id: 'same',
        originalFilename: 'screen.png',
        storedFilename: 'screen.png',
        title: 'Screen',
        description: '',
        position: 1,
        createdAt: '',
        updatedAt: '',
        priority: 'medium',
        annotationFile: 'collections/001-collection/annotations/screen.png.json',
        descriptionFile: 'collections/001-collection/descriptions/screen.png.md',
        originalWidth: 1,
        originalHeight: 1,
        includeInExport: true,
      },
    ];
    project.contentItems = [text('same', 0)];
    expect(() => validateProject(project)).toThrow(/duplicate content IDs/);
  });
});
