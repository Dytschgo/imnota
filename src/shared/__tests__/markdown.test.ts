import { describe, expect, it } from 'vitest';
import { generateMarkdown, numberCollectionScreenshots } from '../markdown.js';
import { emptyProject } from '../utils.js';
import type { Annotation, ScreenshotRecord } from '../types.js';

function screenshot(
  id: string,
  position: number,
  includeInExport = true,
  size: { originalWidth?: number; originalHeight?: number } = {},
): ScreenshotRecord {
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
    originalWidth: size.originalWidth ?? 100,
    originalHeight: size.originalHeight ?? 100,
    includeInExport,
  };
}

const pictureMarks: Annotation[] = [
  { id: 'a1', kind: 'arrow', x: 120, y: 400, points: [0, 0, 595, 12], zIndex: 2 },
  { id: 'r4', kind: 'rectangle', x: 680, y: 380, width: 180, height: 100, zIndex: 0 },
  { id: 's2', kind: 'step', x: 700, y: 400, stepNumber: 1, zIndex: 3 },
  {
    id: 't1',
    kind: 'text',
    text: 'Move the primary action.',
    x: 100,
    y: 200,
    width: 200,
    height: 40,
    zIndex: 1,
  },
];

describe('collection Markdown generation', () => {
  it('numbers sort order before filtering and keeps exclusions explicit', () => {
    const project = emptyProject('Checkout review', '');
    project.collections[0].overallContext = 'Review the checkout flow as a whole.';
    project.screenshots = [screenshot('third', 2), screenshot('first', 0), screenshot('second', 1, false)];
    expect(
      numberCollectionScreenshots(project, '001-collection').map(({ screenshot }) => screenshot.id),
    ).toEqual(['first', 'second', 'third']);
    const annotations: Record<string, Annotation[]> = {
      second: [
        { id: 'hidden', kind: 'arrow', x: 10, y: 10, points: [0, 0, 80, 80], zIndex: 0 },
        { id: 'secret', kind: 'blur', x: 20, y: 20, width: 30, height: 10, zIndex: 1 },
      ],
      third: [
        { id: 'visual', kind: 'rectangle', x: 0, y: 0, width: 18, height: 10, zIndex: 0 },
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
    expect(markdown).toContain(
      '### Picture 3 / Marks\n\n- rectangle `visual` at 0.0%,0.0% 18.0%×10.0%\n- text `text-1` note 1 at 0.0%,0.0% 0.0%×0.0%\n- callout `text-2` note 2 at 0.0%,0.0% 0.0%×0.0%',
    );
    expect(markdown).not.toContain('### Picture 2 / Marks');
    expect(markdown).not.toContain('`hidden`');
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
    const markdown = generateMarkdown(project, '001-collection', {});
    expect(markdown).toContain('## Drawing 1 — Queue\n\nWorkers pull from the left.');
    expect(markdown).not.toContain('Source size:');
  });

  it('retains a minimal reference without description or text annotations', () => {
    const project = emptyProject('Review', '');
    project.screenshots = [screenshot('first', 0)];
    const markdown = generateMarkdown(project, '001-collection', {});
    expect(markdown).toContain(
      '## Picture 1 — first.png\n\nPriority for agent: Medium\n\nSource size: 100×100',
    );
    expect(markdown).not.toContain('/ Marks');
    expect(markdown).not.toContain('/ Note');
    expect(markdown).not.toContain('### Visible text');
  });

  it('includes source pixel size for captured and imported screenshots alike', () => {
    const project = emptyProject('Review', '');
    project.screenshots = [
      screenshot('captured', 0, true, { originalWidth: 1920, originalHeight: 1080 }),
      screenshot('imported', 1, true, { originalWidth: 800, originalHeight: 600 }),
    ];
    const markdown = generateMarkdown(project, '001-collection', {});
    expect(markdown).toContain(
      '## Picture 1 — captured.png\n\nPriority for agent: Medium\n\nSource size: 1920×1080',
    );
    expect(markdown).toContain(
      '## Picture 2 — imported.png\n\nPriority for agent: Medium\n\nSource size: 800×600',
    );
  });

  it('lists arrow, step, and text marks with note cross-references', () => {
    const project = emptyProject('Review', '');
    project.screenshots = [
      screenshot('first', 0, true, { originalWidth: 1000, originalHeight: 1000 }),
      screenshot('second', 1, true, { originalWidth: 1000, originalHeight: 1000 }),
    ];
    const markdown = generateMarkdown(project, '001-collection', { second: pictureMarks });
    expect(markdown).toContain('### Picture 2 / Note 1\n\nMove the primary action.');
    expect(markdown).toContain(
      [
        '### Picture 2 / Marks',
        '',
        '- arrow `a1` from 12.0%,40.0% to 71.5%,41.2%',
        '- rectangle `r4` at 68.0%,38.0% 18.0%×10.0%',
        '- step `s2` number 1 at 70.0%,40.0%',
        '- text `t1` note 1 at 10.0%,20.0% 20.0%×4.0%',
      ].join('\n'),
    );
    expect(markdown).not.toContain('### Picture 1 / Marks');
    expect(markdown).not.toContain('### Picture 1 / Note');
  });

  it('changes Picture numbers in Notes and Marks together when screenshots are reordered', () => {
    const project = emptyProject('Review', '');
    const alpha = screenshot('alpha', 0, true, { originalWidth: 1000, originalHeight: 1000 });
    const beta = screenshot('beta', 1, true, { originalWidth: 1000, originalHeight: 1000 });
    project.screenshots = [alpha, beta];
    const annotations = { alpha: pictureMarks, beta: pictureMarks };
    const before = generateMarkdown(project, '001-collection', annotations);
    expect(before).toContain('### Picture 1 / Note 1');
    expect(before).toContain('### Picture 1 / Marks\n\n- arrow `a1`');
    expect(before).toContain('### Picture 2 / Note 1');
    expect(before).toContain('### Picture 2 / Marks\n\n- arrow `a1`');
    alpha.position = 1;
    beta.position = 0;
    const after = generateMarkdown(project, '001-collection', annotations);
    expect(after.indexOf('## Picture 1 — beta.png')).toBeLessThan(after.indexOf('## Picture 2 — alpha.png'));
    expect(after).toContain('## Picture 1 — beta.png');
    expect(after).toContain('### Picture 1 / Note 1\n\nMove the primary action.');
    expect(after).toContain('### Picture 1 / Marks\n\n- arrow `a1` from 12.0%,40.0% to 71.5%,41.2%');
    expect(after).toContain('## Picture 2 — alpha.png');
    expect(after).toContain('### Picture 2 / Note 1\n\nMove the primary action.');
    expect(after).toContain('### Picture 2 / Marks\n\n- arrow `a1` from 12.0%,40.0% to 71.5%,41.2%');
  });

  it('omits Marks for excluded screenshots even when annotations exist', () => {
    const project = emptyProject('Review', '');
    project.screenshots = [screenshot('first', 0, false, { originalWidth: 1000, originalHeight: 1000 })];
    const markdown = generateMarkdown(project, '001-collection', { first: pictureMarks });
    expect(markdown).toContain('Picture 1 was intentionally excluded from this prompt bundle.');
    expect(markdown).not.toContain('Source size:');
    expect(markdown).not.toContain('/ Marks');
    expect(markdown).not.toContain('/ Note');
    expect(markdown).not.toContain('arrow');
    expect(markdown).not.toContain('Move the primary action.');
  });

  it('omits redaction and crop geometry from Marks', () => {
    const project = emptyProject('Review', '');
    project.screenshots = [screenshot('first', 0)];
    const markdown = generateMarkdown(project, '001-collection', {
      first: [
        { id: 'secret-blur', kind: 'blur', x: 33, y: 44, width: 55, height: 16, zIndex: 0 },
        { id: 'secret-pixels', kind: 'pixelate', x: 12, y: 8, width: 9, height: 7, zIndex: 1 },
        { id: 'crop-op', kind: 'crop', x: 5, y: 6, width: 70, height: 80, zIndex: 2 },
        { id: 'r4', kind: 'rectangle', x: 10, y: 20, width: 30, height: 15, zIndex: 3 },
      ],
    });
    expect(markdown).toContain('### Picture 1 / Marks\n\n- rectangle `r4` at 10.0%,20.0% 30.0%×15.0%\n');
    expect(markdown).not.toContain('blur');
    expect(markdown).not.toContain('pixelate');
    expect(markdown).not.toContain('crop');
    expect(markdown).not.toContain('secret-blur');
    expect(markdown).not.toContain('secret-pixels');
    expect(markdown).not.toContain('33.0%');
    expect(markdown).not.toContain('12.0%');
    const redactionOnly = generateMarkdown(project, '001-collection', {
      first: [
        { id: 'secret-blur', kind: 'blur', x: 33, y: 44, width: 55, height: 16, zIndex: 0 },
        { id: 'secret-pixels', kind: 'pixelate', x: 12, y: 8, width: 9, height: 7, zIndex: 1 },
        { id: 'crop-op', kind: 'crop', x: 5, y: 6, width: 70, height: 80, zIndex: 2 },
      ],
    });
    expect(redactionOnly).not.toContain('/ Marks');
    expect(redactionOnly).not.toContain('33.0%');
  });

  it('appends recognised Visible text without writing it into the description', () => {
    const project = emptyProject('Review', '');
    project.screenshots = [screenshot('first', 0)];
    const markdown = generateMarkdown(project, '001-collection', {}, {}, { first: 'Submit order' });
    expect(markdown).toContain(
      '## Picture 1 — first.png\n\nPriority for agent: Medium\n\nSource size: 100×100\n\n### Visible text\n\nSubmit order\n',
    );
    expect(markdown).not.toContain('Keep the primary action visible.');
    expect(markdown.indexOf('Source size: 100×100')).toBeLessThan(markdown.indexOf('### Visible text'));
  });

  it('omits Visible text when a redaction exists even if recognised text is supplied', () => {
    const project = emptyProject('Review', '');
    project.screenshots = [screenshot('first', 0)];
    const markdown = generateMarkdown(
      project,
      '001-collection',
      {
        first: [{ id: 'secret-blur', kind: 'blur', x: 33, y: 44, width: 55, height: 16, zIndex: 0 }],
      },
      {},
      { first: 'secret token' },
    );
    expect(markdown).not.toContain('### Visible text');
    expect(markdown).not.toContain('secret token');
  });

  it('lists remaining visual kinds, negative box bounds, and PNG arrow-point fallbacks', () => {
    const project = emptyProject('Review', '');
    project.screenshots = [screenshot('first', 0)];
    const markdown = generateMarkdown(project, '001-collection', {
      first: [
        { id: 'ln', kind: 'line', x: 10, y: 20, points: [0, 0, 40, 10], zIndex: 0 },
        { id: 'rr', kind: 'rounded-rectangle', x: 50, y: 10, width: 20, height: 10, zIndex: 1 },
        { id: 'el', kind: 'ellipse', x: 5, y: 5, width: 10, height: 20, zIndex: 2 },
        { id: 'hi', kind: 'highlight', x: 0, y: 80, width: 100, height: 10, zIndex: 3 },
        { id: 'pen', kind: 'pen', x: 20, y: 30, points: [0, 0, 10, -5, 15, 20], zIndex: 4 },
        { id: 'neg', kind: 'rectangle', x: 80, y: 40, width: -30, height: 20, zIndex: 5 },
        { id: 'a0', kind: 'arrow', x: 0, y: 0, zIndex: 6 },
      ],
    });
    expect(markdown).toContain(
      [
        '### Picture 1 / Marks',
        '',
        '- line `ln` from 10.0%,20.0% to 50.0%,30.0%',
        '- rounded-rectangle `rr` at 50.0%,10.0% 20.0%×10.0%',
        '- ellipse `el` at 5.0%,5.0% 10.0%×20.0%',
        '- highlight `hi` at 0.0%,80.0% 100.0%×10.0%',
        '- pen `pen` at 20.0%,25.0% 15.0%×25.0%',
        '- rectangle `neg` at 50.0%,40.0% 30.0%×20.0%',
        '- arrow `a0` from 0.0%,0.0% to 10.0%,10.0%',
      ].join('\n'),
    );
  });
});
