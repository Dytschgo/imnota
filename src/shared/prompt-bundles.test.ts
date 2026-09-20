import { describe, expect, it } from 'vitest';
import type { Annotation } from './types';
import {
  calculatePromptBundleLayout,
  encodedOverflowBreak,
  applyPromptBundleMarkdownIdentity,
  mapPromptTextNotes,
  planPromptBundles,
  type PromptCollectionInput,
  type PromptScreenshotInput,
  type MeasuredPromptScreenshot,
} from './prompt-bundles';

function screenshot(
  id: string,
  position: number,
  overrides: Partial<PromptScreenshotInput> = {},
): PromptScreenshotInput {
  return {
    id,
    position,
    title: `${id} title`,
    originalFilename: `${id}.png`,
    description: '',
    priority: 'medium',
    includeInExport: true,
    nativeWidth: 100,
    nativeHeight: 100,
    contentRevision: `${id}-revision`,
    annotations: [],
    ...overrides,
  };
}

function collection(screenshots: PromptScreenshotInput[]): PromptCollectionInput {
  return {
    collectionId: '001-collection',
    collectionName: 'Checkout / Collection 02',
    overallContext: 'Preserve the existing checkout flow.',
    screenshots,
  };
}

function rendered(id: string, width = 100, height = 100, characters = 100): MeasuredPromptScreenshot {
  return {
    screenshotId: id,
    width,
    height,
    estimatedPngCharacters: characters,
  };
}

function annotation(id: string, kind: Annotation['kind'], fields: Partial<Annotation> = {}): Annotation {
  return { id, kind, x: 0, y: 0, zIndex: 0, ...fields };
}

const pictureMarks: Annotation[] = [
  annotation('a1', 'arrow', { x: 120, y: 400, points: [0, 0, 595, 12], zIndex: 2 }),
  annotation('s2', 'step', { x: 700, y: 400, stepNumber: 1, zIndex: 3 }),
  annotation('t1', 'text', {
    text: 'Move the primary action.',
    x: 100,
    y: 200,
    width: 200,
    height: 40,
    zIndex: 1,
  }),
];

describe('prompt note mapping', () => {
  it('uses original array order independent of z-index-like fields', () => {
    const annotations = [
      annotation('first', 'text', { text: 'Created first', zIndex: 99 }),
      annotation('shape', 'rectangle', { text: 'Visual only', zIndex: 0 }),
      annotation('second', 'callout', { text: 'Created second', zIndex: -1 }),
      annotation('blank', 'text', { text: '   ', zIndex: 1 }),
    ];
    expect(mapPromptTextNotes(annotations)).toEqual([
      { number: 1, text: 'Created first' },
      { number: 2, text: 'Created second' },
    ]);
  });
});

describe('prompt bundle planning', () => {
  it('numbers before filtering, keeps creation-order notes, and repeats exclusions in every bundle', () => {
    const input = collection([
      screenshot('third', 30, {
        annotations: [
          annotation('n1', 'text', { text: 'First note' }),
          annotation('n2', 'callout', { text: 'Second note' }),
        ],
      }),
      screenshot('first', 10),
      screenshot('excluded', 20, { includeInExport: false }),
    ]);
    const result = planPromptBundles(input, [rendered('first'), rendered('third')], {
      limits: { maxPixels: 30_000 },
    });
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.bundles).toHaveLength(2);
    expect(result.bundles.map((bundle) => bundle.pictureNumbers)).toEqual([[1], [3]]);
    expect(
      result.bundles.every((bundle) => bundle.markdown.includes('Picture 2 was intentionally excluded')),
    ).toBe(true);
    expect(result.bundles[1].markdown).toContain('Picture 3 / Note 1\n\nFirst note');
    expect(result.bundles[1].markdown).toContain('Picture 3 / Note 2\n\nSecond note');
    expect(result.bundles[0].markdown).toContain('## Overall context');
    expect(result.bundles[1].markdown).toContain('Shared collection context is included in Bundle 1.');
  });

  it('splits at native dimensions and never silently resizes', () => {
    const input = collection([screenshot('one', 0), screenshot('two', 1)]);
    const result = planPromptBundles(input, [rendered('one', 3840, 2160), rendered('two', 3840, 2160)]);
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.bundles).toHaveLength(2);
    expect(result.bundles[0].pictures[0]).toMatchObject({ width: 3840, height: 2160 });
    expect(result.bundles[0].layout.items[0]).toMatchObject({ width: 3840, height: 2160 });
  });

  it('marks a single oversized visual as file-only and offers a deterministic encoded-overflow split', () => {
    const huge = planPromptBundles(collection([screenshot('huge', 0)]), [rendered('huge', 9000, 100)]);
    expect(huge.kind).toBe('ready');
    if (huge.kind !== 'ready') return;
    expect(huge.bundles[0].delivery).toBe('file-only');
    expect(huge.bundles[0].warning).toMatch(/saved PNG and Markdown/);

    const pair = planPromptBundles(collection([screenshot('one', 0), screenshot('two', 1)]), [
      rendered('one'),
      rendered('two'),
    ]);
    expect(pair.kind).toBe('ready');
    if (pair.kind === 'ready') expect(encodedOverflowBreak(pair.bundles[0])).toBe('two');
  });

  it('returns friendly no-content results for empty and all-excluded collections', () => {
    expect(planPromptBundles(collection([]), [])).toEqual({
      kind: 'no-content',
      message: 'This collection has no screenshots yet. Add a screenshot to create a prompt bundle.',
    });
    expect(planPromptBundles(collection([screenshot('hidden', 0, { includeInExport: false })]), [])).toEqual({
      kind: 'no-content',
      message: 'No screenshots are included. Turn on at least one screenshot to create a prompt bundle.',
    });
  });

  it('honours explicit breaks used after actual encoded overflow', () => {
    const input = collection([screenshot('one', 0), screenshot('two', 1), screenshot('three', 2)]);
    const result = planPromptBundles(input, [rendered('one'), rendered('two'), rendered('three')], {
      breakBeforeScreenshotIds: new Set(['three']),
    });
    expect(result.kind).toBe('ready');
    if (result.kind === 'ready')
      expect(result.bundles.map((bundle) => bundle.pictureNumbers)).toEqual([[1, 2], [3]]);
  });

  it('keeps plans metadata-only and injects the reserved export identity into Markdown later', () => {
    const result = planPromptBundles(collection([screenshot('one', 0)]), [rendered('one')]);
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.bundles[0].pictures[0].dataUrl).toBeUndefined();
    const stamped = applyPromptBundleMarkdownIdentity(result, {
      setName: 'Checkout Collection - 260907-184205',
    });
    expect(stamped.bundles[0].reference).toBe('Checkout Collection - 260907-184205 - 01');
    expect(stamped.bundles[0].markdown).toContain(
      'Bundle reference: Checkout Collection - 260907-184205 - 01',
    );
    expect(stamped.bundles[0].markdown).toContain('Source size: 100×100');
  });

  it('includes source pixel size from native dimensions, not composed layout size', () => {
    const input = collection([
      screenshot('captured', 0, { nativeWidth: 1920, nativeHeight: 1080 }),
      screenshot('imported', 1, { nativeWidth: 800, nativeHeight: 600 }),
    ]);
    const result = planPromptBundles(input, [
      rendered('captured', 3840, 2160),
      rendered('imported', 1600, 1200),
    ]);
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.bundles[0].markdown).toContain(
      '## Picture 1 — captured title\n\nPriority for agent: Medium\n\nSource size: 1920×1080',
    );
    expect(result.bundles[0].markdown).toContain(
      '## Picture 2 — imported title\n\nPriority for agent: Medium\n\nSource size: 800×600',
    );
    expect(result.bundles[0].markdown).not.toContain('Source size: 3840×2160');
    expect(result.bundles[0].markdown).not.toContain('Source size: 1600×1200');
  });

  it('preserves meaningful Markdown indentation in context, descriptions, and text notes', () => {
    const input = collection([
      screenshot('one', 0, {
        description: 'Description:\r\n\r\n    code()',
        annotations: [annotation('note', 'text', { text: '    noteCode()' })],
      }),
    ]);
    input.overallContext = 'Context:\r\n\r\n    setup()';
    const result = planPromptBundles(input, [rendered('one')]);
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.bundles[0].markdown).toContain('Context:\n\n    setup()');
    expect(result.bundles[0].markdown).toContain('Description:\n\n    code()');
    expect(result.bundles[0].markdown).toContain('### Picture 1 / Note 1\n\n    noteCode()');
  });

  it('keeps mixed content interleaved, numbers only visuals, and supports text-only bundles', () => {
    const input: PromptCollectionInput = {
      ...collection([]),
      items: [
        {
          id: 'text-before',
          kind: 'text',
          position: 0,
          includeInExport: true,
          markdown: '## User heading\n\nStart with this.',
          contentRevision: 't1',
        },
        screenshot('screen', 1),
        {
          id: 'drawing',
          kind: 'drawing',
          position: 2,
          title: 'Flow',
          originalFilename: 'Flow',
          description: 'Queue sits in front of the workers.',
          includeInExport: true,
          nativeWidth: 80,
          nativeHeight: 40,
          contentRevision: 'd1',
          sourceFilename: 'flow.json',
        },
        {
          id: 'hidden-text',
          kind: 'text',
          position: 3,
          includeInExport: false,
          markdown: '',
          contentRevision: 'hidden',
        },
        screenshot('hidden-screen', 4, { includeInExport: false }),
      ],
    };
    const mixed = planPromptBundles(input, [rendered('screen'), rendered('drawing', 80, 40)]);
    expect(mixed.kind).toBe('ready');
    if (mixed.kind !== 'ready') return;
    expect(mixed.bundles[0].pictureNumbers).toEqual([1, 2]);
    expect(mixed.bundles[0].markdown).toMatch(/Start with this\.[\s\S]*## Picture 1[\s\S]*## Drawing 2/);
    expect(mixed.bundles[0].markdown).toContain('Queue sits in front of the workers.');
    expect(mixed.bundles[0].markdown).toContain('## User heading');
    expect(mixed.bundles[0].markdown).not.toContain('## Text');
    expect(mixed.bundles[0].markdown).toContain('Picture 3 was intentionally excluded');
    expect(mixed.bundles[0].markdown).toContain('A text block was intentionally excluded');

    const textOnly = planPromptBundles({ ...collection([]), items: [input.items![0]] }, []);
    expect(textOnly).toMatchObject({ kind: 'ready' });
    if (textOnly.kind === 'ready') {
      expect(textOnly.bundles[0]).toMatchObject({ pictureNumbers: [], layout: { width: 0, height: 0 } });
      expect(textOnly.bundles[0].markdown).toContain('Start with this.');
    }

    const drawingOnly = planPromptBundles(
      {
        ...collection([]),
        items: [
          {
            id: 'drawing-only',
            kind: 'drawing',
            position: 0,
            title: 'Architecture',
            originalFilename: 'Architecture',
            includeInExport: true,
            nativeWidth: 90,
            nativeHeight: 60,
            contentRevision: 'drawing-only-1',
            sourceFilename: 'architecture.json',
          },
        ],
      },
      [rendered('drawing-only', 90, 60)],
    );
    if (drawingOnly.kind === 'ready') {
      expect(drawingOnly.bundles[0].markdown).toContain('## Drawing 1 — Architecture');
      expect(drawingOnly.bundles[0].markdown).not.toContain('Source size:');
      expect(drawingOnly.bundles[0].pictureNumbers).toEqual([1]);
    } else throw new Error(drawingOnly.message);
  });

  it('retains duplicate ID, dimensions, and split safety checks for mixed collections', () => {
    expect(() =>
      planPromptBundles(
        {
          ...collection([]),
          items: [screenshot('same', 0), { ...screenshot('same', 1), kind: 'screenshot' }],
        },
        [rendered('same')],
      ),
    ).toThrow(/duplicate content item IDs/);
    expect(() => planPromptBundles({ ...collection([]), items: [screenshot('missing', 0)] }, [])).toThrow(
      /Measured visual is missing/,
    );
    expect(() =>
      planPromptBundles({ ...collection([]), items: [screenshot('bad', 0)] }, [rendered('bad', 0, 100)]),
    ).toThrow(/width must be a positive integer/);
  });

  it('describes visual marks in Copy Bundle markdown and omits excluded and redacted geometry', () => {
    const input = collection([
      screenshot('first', 0),
      screenshot('second', 1, {
        nativeWidth: 1000,
        nativeHeight: 1000,
        annotations: pictureMarks,
      }),
      screenshot('hidden', 2, {
        includeInExport: false,
        nativeWidth: 1000,
        nativeHeight: 1000,
        annotations: pictureMarks,
      }),
    ]);
    const result = planPromptBundles(input, [rendered('first'), rendered('second')]);
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.bundles[0].markdown).toContain('### Picture 2 / Note 1\n\nMove the primary action.');
    expect(result.bundles[0].markdown).toContain(
      [
        '### Picture 2 / Marks',
        '',
        '- arrow `a1` from 12.0%,40.0% to 71.5%,41.2%',
        '- step `s2` number 1 at 70.0%,40.0%',
        '- text `t1` note 1 at 10.0%,20.0% 20.0%×4.0%',
      ].join('\n'),
    );
    expect(result.bundles[0].markdown).toContain('Picture 3 was intentionally excluded');
    expect(result.bundles[0].markdown).not.toContain('### Picture 3 / Marks');
    expect(result.bundles[0].markdown).not.toContain('### Picture 1 / Marks');

    const redacted = planPromptBundles(
      collection([
        screenshot('secret', 0, {
          annotations: [
            annotation('blur', 'blur', { x: 33, y: 44, width: 55, height: 16 }),
            annotation('pixels', 'pixelate', { x: 12, y: 8, width: 9, height: 7 }),
            annotation('crop', 'crop', { x: 5, y: 6, width: 70, height: 80 }),
            annotation('r4', 'rectangle', { x: 10, y: 20, width: 30, height: 15 }),
          ],
        }),
      ]),
      [rendered('secret')],
    );
    expect(redacted.kind).toBe('ready');
    if (redacted.kind !== 'ready') return;
    expect(redacted.bundles[0].markdown).toContain(
      '### Picture 1 / Marks\n\n- rectangle `r4` at 10.0%,20.0% 30.0%×15.0%',
    );
    expect(redacted.bundles[0].markdown).not.toContain('blur');
    expect(redacted.bundles[0].markdown).not.toContain('pixelate');
    expect(redacted.bundles[0].markdown).not.toContain('33.0%');
  });

  it('appends Visible text from injected OCR and omits it for redacted screenshots', () => {
    const result = planPromptBundles(collection([screenshot('first', 0, { visibleText: 'Submit order' })]), [
      rendered('first'),
    ]);
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.bundles[0].markdown).toContain('### Visible text\n\nSubmit order\n');
    expect(result.bundles[0].pictures[0].description).toBe('');

    const redacted = planPromptBundles(
      collection([
        screenshot('secret', 0, {
          visibleText: 'secret token',
          annotations: [annotation('blur', 'blur', { x: 1, y: 1, width: 8, height: 8 })],
        }),
      ]),
      [rendered('secret')],
    );
    expect(redacted.kind).toBe('ready');
    if (redacted.kind !== 'ready') return;
    expect(redacted.bundles[0].markdown).not.toContain('### Visible text');
    expect(redacted.bundles[0].markdown).not.toContain('secret token');
    expect(redacted.bundles[0].pictures[0].visibleText).toBeUndefined();
  });
});

describe('prompt layout', () => {
  it('centres narrower screenshots without scaling', () => {
    const layout = calculatePromptBundleLayout([
      { screenshotId: 'wide', pictureNumber: 1, width: 300, height: 100 },
      { screenshotId: 'narrow', pictureNumber: 2, width: 100, height: 50 },
    ]);
    expect(layout.width).toBe(364);
    expect(layout.items[0]).toMatchObject({ x: 32, width: 300 });
    expect(layout.items[1]).toMatchObject({ x: 132, width: 100 });
  });
});
