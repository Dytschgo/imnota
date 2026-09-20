// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { generateMarkdown, numberCollectionScreenshots } from '../markdown.js';
import { emptyProject } from '../utils.js';
import type { Annotation, ScreenshotRecord } from '../types.js';

function screenshot(id: string, position: number, includeInExport = true): ScreenshotRecord {
  return {
    collectionId: '001-collection',
    id,
    originalFilename: `${id}.png`,
    storedFilename: `${id}.png`,
    title: `${id}.png`,
    description: id === 'third' ? 'Keep the primary action visible.' : '',
    position,
    createdAt: `2026-01-0${position + 1}`,
    updatedAt: '',
    priority: id === 'third' ? 'high' : 'medium',
    annotationFile: `collections/001-collection/annotations/${id}.png.json`,
    descriptionFile: `collections/001-collection/descriptions/${id}.png.md`,
    originalWidth: 100,
    originalHeight: 100,
    includeInExport,
  };
}

describe('collection Markdown generation', () => {
  it('numbers sort order before filtering and keeps exclusions explicit', () => {
    const project = emptyProject('Checkout review', '');
    project.collections[0].overallContext = 'Review the checkout flow as a whole.';
    project.screenshots = [screenshot('third', 2), screenshot('first', 0), screenshot('second', 1, false)];
    expect(
      numberCollectionScreenshots(project, '001-collection').map(({ screenshot }) => screenshot.id),
    ).toEqual(['first', 'second', 'third']);
    const annotations: Record<string, Annotation[]> = {
      third: [
        { id: 'visual', kind: 'rectangle', x: 0, y: 0, zIndex: 0 },
        { id: 'text-1', kind: 'text', text: 'Move this action.', x: 0, y: 0, zIndex: 1 },
        { id: 'text-2', kind: 'callout', text: 'Keep this label.', x: 0, y: 0, zIndex: 2 },
      ],
    };
    const markdown = generateMarkdown(project, '001-collection', annotations);
    expect(markdown).toContain('## Overall context');
    expect(markdown).toContain('Picture 2 was intentionally excluded');
    expect(markdown).toContain('## Picture 3 — third.png');
    expect(markdown).toContain('Priority for agent: High');
    expect(markdown).toContain('Keep the primary action visible.');
    expect(markdown).toContain('### Picture 3 / Note 1');
    expect(markdown).toContain('### Picture 3 / Note 2');
    expect(markdown).not.toContain('rectangle');
  });

  it('writes drawing descriptions under the drawing heading', () => {
    const project = emptyProject('Architecture', '');
    project.schemaVersion = 4;
    project.contentItems = [
      {
        id: 'flow',
        collectionId: '001-collection',
        kind: 'drawing',
        position: 0,
        includeInExport: true,
        createdAt: '2026-09-07T00:00:00.000Z',
        updatedAt: '2026-09-07T00:00:00.000Z',
        title: 'Queue',
        description: 'Workers pull from the left.',
        sourceFilename: 'flow.json',
        imageFilename: 'flow.png',
        originalWidth: 160,
        originalHeight: 120,
      },
    ];
    expect(generateMarkdown(project, '001-collection', {})).toContain(
      '## Drawing 1 — Queue\n\nWorkers pull from the left.',
    );
  });

  it('retains a minimal reference without description or text annotations', () => {
    const project = emptyProject('Review', '');
    project.screenshots = [screenshot('first', 0)];
    expect(generateMarkdown(project, '001-collection', {})).toContain(
      '## Picture 1 — first.png\n\nPriority for agent: Medium',
    );
  });
});
