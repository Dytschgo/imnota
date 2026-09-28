import { describe, expect, it } from 'vitest';
import type { PromptCollectionInput } from '../../shared/prompt-bundles';
import { fingerprintPromptExportSnapshot, PROMPT_EXPORT_SNAPSHOT_VERSION } from './prompt-export-snapshot';

const textItem = {
  id: 'text-a',
  kind: 'text' as const,
  position: 1,
  includeInExport: true,
  markdown: 'Expected behavior',
  contentRevision: 'revision-1',
};

const snapshot: PromptCollectionInput = {
  collectionId: 'collection-a',
  collectionName: 'Feedback',
  overallContext: 'Review the updated screen.',
  screenshots: [],
  items: [textItem],
};

describe('prompt export snapshot identity', () => {
  it('uses a versioned stable fingerprint for the same saved input', async () => {
    expect(PROMPT_EXPORT_SNAPSHOT_VERSION).toBe(2);
    await expect(fingerprintPromptExportSnapshot(snapshot)).resolves.toBe(
      await fingerprintPromptExportSnapshot(snapshot),
    );
  });

  it('changes when content, order, or export metadata changes', async () => {
    const original = await fingerprintPromptExportSnapshot(snapshot);
    const changedText = await fingerprintPromptExportSnapshot({
      ...snapshot,
      items: [{ ...textItem, markdown: 'Different expected behavior' }],
    });
    const changedInclusion = await fingerprintPromptExportSnapshot({
      ...snapshot,
      items: [{ ...textItem, includeInExport: false }],
    });
    const changedCollection = await fingerprintPromptExportSnapshot({
      ...snapshot,
      collectionName: 'New name',
    });

    expect(new Set([original, changedText, changedInclusion, changedCollection]).size).toBe(4);
  });

  it('preserves ordered mixed content as part of the snapshot identity', async () => {
    const text = textItem;
    const drawing = {
      id: 'drawing-a',
      kind: 'drawing' as const,
      position: 2,
      title: 'Flow',
      originalFilename: 'flow.png',
      includeInExport: true,
      nativeWidth: 320,
      nativeHeight: 240,
      contentRevision: 'drawing-revision-1',
      sourceFilename: 'flow.json',
    };
    const first = await fingerprintPromptExportSnapshot({
      ...snapshot,
      items: [text, drawing],
    });
    const reordered = await fingerprintPromptExportSnapshot({
      ...snapshot,
      items: [
        { ...drawing, position: 1 },
        { ...text, position: 2 },
      ],
    });

    expect(first).not.toBe(reordered);
  });
});
