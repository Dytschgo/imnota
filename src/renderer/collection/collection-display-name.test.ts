import { describe, expect, it } from 'vitest';
import { collectionDisplayName } from './collection-display-name';

describe('collectionDisplayName', () => {
  it('shortens a generated name when it remains distinct', () => {
    expect(collectionDisplayName('Imnota / Collection 01', 'C:\\Work\\Imnota', ['Collection 02'])).toBe(
      'Collection 01',
    );
  });

  it('keeps the folder prefix when shortening would hide a distinct collection', () => {
    const projectPath = 'C:\\Work\\Imnota';
    expect(collectionDisplayName('Imnota / Collection 01', projectPath, ['Collection 01'])).toBe(
      'Imnota / Collection 01',
    );
    expect(collectionDisplayName('Collection 01', projectPath, ['Imnota / Collection 01'])).toBe(
      'Collection 01',
    );
  });
});
