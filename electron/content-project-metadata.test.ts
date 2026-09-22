// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { DrawingRecord, TextBlockRecord } from '../src/shared/content-items.js';
import { emptyProject } from '../src/shared/utils.js';
import type { ProjectData, ScreenshotRecord } from '../src/shared/types.js';
import { preserveMixedProjectMetadata } from './content-project-metadata.js';

const timestamp = '2026-09-07T00:00:00.000Z';
const screenshot: ScreenshotRecord = {
  id: 'shot_a',
  collectionId: '001-collection',
  originalFilename: 'original.png',
  storedFilename: 'original.png',
  title: 'Evidence',
  description: 'Keep this',
  position: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
  priority: 'medium',
  annotationFile: 'collections/001-collection/annotations/original.png.json',
  descriptionFile: 'collections/001-collection/descriptions/original.png.md',
  originalWidth: 100,
  originalHeight: 100,
  includeInExport: true,
};

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
      description: '',
      sourceFilename: 'drawing_a.json',
      imageFilename: 'drawing_a.png',
      originalWidth: 160,
      originalHeight: 120,
    },
  ];
}

describe('mixed metadata preservation', () => {
  it.each([3, 4] as const)(
    'rejects a stale screenshot list in schema %s without changing the trusted project',
    (schemaVersion) => {
      const current: ProjectData = {
        ...emptyProject('Evidence', ''),
        schemaVersion,
        screenshots: [screenshot],
        ...(schemaVersion === 4 ? { contentItems: [] } : {}),
      };
      const before = structuredClone(current);
      expect(() => preserveMixedProjectMetadata(current, { ...current, screenshots: [] })).toThrow(
        /screenshot list changed/,
      );
      expect(() =>
        preserveMixedProjectMetadata(current, { ...current, screenshots: [{ ...screenshot, id: 'other' }] }),
      ).toThrow(/screenshot list changed/);
      expect(current).toEqual(before);
    },
  );

  it('refuses native screenshot path and dimension changes but retains reorder and visibility edits', () => {
    const current = {
      ...emptyProject('Evidence', ''),
      screenshots: [
        screenshot,
        {
          ...screenshot,
          id: 'shot_b',
          storedFilename: 'b.png',
          annotationFile: 'collections/001-collection/annotations/b.png.json',
          descriptionFile: 'collections/001-collection/descriptions/b.png.md',
          position: 1,
        },
      ],
    };
    for (const change of [
      { collectionId: 'other' },
      { storedFilename: 'other.png' },
      { annotationFile: 'other.json' },
      { descriptionFile: 'other.md' },
      { originalWidth: 200 },
    ]) {
      expect(() =>
        preserveMixedProjectMetadata(current, {
          ...current,
          screenshots: [{ ...screenshot, ...change }, current.screenshots[1]],
        }),
      ).toThrow(/identity or file locations/);
    }
    const saved = preserveMixedProjectMetadata(current, {
      ...current,
      screenshots: [
        { ...current.screenshots[1], position: 0, includeInExport: false },
        { ...screenshot, position: 1 },
      ],
    });
    expect(saved.screenshots.map((shot) => [shot.id, shot.position, shot.includeInExport])).toEqual([
      ['shot_b', 0, false],
      ['shot_a', 1, true],
    ]);
  });
  it('preserves v4 records when a legacy v3 writer saves screenshot metadata', () => {
    const current = { ...emptyProject('Mixed', ''), schemaVersion: 4 as const, contentItems: records() };
    const candidate = { ...current, schemaVersion: 3 as const, contentItems: undefined };
    const saved = preserveMixedProjectMetadata(current, candidate);
    expect(saved.schemaVersion).toBe(4);
    expect(saved.contentItems).toEqual(current.contentItems);
  });

  it('allows order, visibility, title, and description edits while retaining native paths, preview, and dimensions', () => {
    const current = { ...emptyProject('Mixed', ''), schemaVersion: 4 as const, contentItems: records() };
    const candidate = {
      ...current,
      updatedAt: '2026-09-07T00:00:01.000Z',
      contentItems: [
        { ...current.contentItems[0], position: 1, includeInExport: false, preview: 'Untrusted' },
        {
          ...current.contentItems[1],
          position: 0,
          title: 'Edited architecture',
          description: 'Keep the queue in front of the workers.',
        },
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
        description: 'Keep the queue in front of the workers.',
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
