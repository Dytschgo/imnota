import { describe, expect, it } from 'vitest';
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

describe('prompt note mapping', () => {
  it('uses original array order independent of z-index-like fields', () => {
    const annotations = [
      { kind: 'text', text: 'Created first', zIndex: 99 },
      { kind: 'rectangle', text: 'Visual only', zIndex: 0 },
      { kind: 'callout', text: 'Created second', zIndex: -1 },
      { kind: 'text', text: '   ', zIndex: 1 },
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
          { kind: 'text', text: 'First note' },
          { kind: 'callout', text: 'Second note' },
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
    expect(result.bundles[1].markdown).toContain('Shared collection context is included in Prompt 1.');
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
  });

  it('preserves meaningful Markdown indentation in context, descriptions, and text notes', () => {
    const input = collection([
      screenshot('one', 0, {
        description: 'Description:\r\n\r\n    code()',
        annotations: [{ kind: 'text', text: '    noteCode()' }],
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
