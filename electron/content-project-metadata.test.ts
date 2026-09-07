// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { DrawingRecord, TextBlockRecord } from '../src/shared/content-items.js';
import { emptyProject } from '../src/shared/utils.js';
import { preserveMixedProjectMetadata } from './content-project-metadata.js';

const timestamp = '2026-09-07T00:00:00.000Z';

function records(): [TextBlockRecord, DrawingRecord] {
  return [
    {
      id: 'text_a',
      collectionId: '001-collection',
      kind: 'text',
      position: 0,
      includeInExport: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      markdownFilename: 'text_a.md',
      preview: 'Trusted preview',
    },
    {
      id: 'drawing_a',
      collectionId: '001-collection',
      kind: 'drawing',
      position: 1,
      includeInExport: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      title: 'Architecture',
      sourceFilename: 'drawing_a.json',
      imageFilename: 'drawing_a.png',
      originalWidth: 160,
      originalHeight: 120,
    },
  ];
}

describe('mixed metadata preservation', () => {
  it('preserves v4 records when a legacy v3 writer saves screenshot metadata', () => {
    const current = { ...emptyProject('Mixed', ''), schemaVersion: 4 as const, contentItems: records() };
    const candidate = { ...current, schemaVersion: 3 as const, contentItems: undefined };
    const saved = preserveMixedProjectMetadata(current, candidate);
    expect(saved.schemaVersion).toBe(4);
    expect(saved.contentItems).toEqual(current.contentItems);
  });

  it('allows order, visibility, and title edits while retaining native paths, preview, and dimensions', () => {
    const current = { ...emptyProject('Mixed', ''), schemaVersion: 4 as const, contentItems: records() };
    const candidate = {
      ...current,
      updatedAt: '2026-09-07T00:00:01.000Z',
      contentItems: [
        { ...current.contentItems[0], position: 1, includeInExport: false, preview: 'Untrusted' },
        { ...current.contentItems[1], position: 0, title: 'Edited architecture' },
      ],
    };
    const saved = preserveMixedProjectMetadata(current, candidate);
    expect(saved.contentItems).toEqual([
      expect.objectContaining({
        id: 'text_a',
        position: 1,
        includeInExport: false,
        preview: 'Trusted preview',
        updatedAt: candidate.updatedAt,
      }),
      expect.objectContaining({
        id: 'drawing_a',
        position: 0,
        title: 'Edited architecture',
        originalWidth: 160,
        updatedAt: candidate.updatedAt,
      }),
    ]);
  });

  it('rejects renderer-created records, path mutation, and renderer-triggered v4 upgrades', () => {
    const version3 = emptyProject('Existing', '');
    expect(() =>
      preserveMixedProjectMetadata(version3, {
        ...version3,
        schemaVersion: 4,
        contentItems: records(),
      }),
    ).toThrow(/Only native content creation/);

    const current = { ...version3, schemaVersion: 4 as const, contentItems: records() };
    expect(() =>
      preserveMixedProjectMetadata(current, {
        ...current,
        contentItems: [
          ...current.contentItems,
          { ...records()[0], id: 'text_b', markdownFilename: 'text_b.md' },
        ],
      }),
    ).toThrow(/created and deleted through the native content bridge/);
    expect(() =>
      preserveMixedProjectMetadata(current, {
        ...current,
        contentItems: current.contentItems.map((item) =>
          item.kind === 'drawing' ? { ...item, imageFilename: 'changed.png' } : item,
        ),
      }),
    ).toThrow(/identity, paths, and dimensions/);
  });
});
