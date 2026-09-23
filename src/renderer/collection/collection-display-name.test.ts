import { describe, expect, it } from 'vitest';
import { collectionDisplayName } from './collection-display-name';
import { emptyProject } from '../../shared/utils';

describe('collectionDisplayName', () => {
  it('shortens a generated name when it remains distinct', () => {
    expect(
      collectionDisplayName('Imnota / Collection 01', 'C:\\Work\\Imnota\\feedback', ['Collection 02']),
    ).toBe('Collection 01');
  });

  it('keeps the folder prefix when shortening would hide a distinct collection', () => {
    const projectPath = 'C:\\Work\\Imnota\\feedback';
    expect(collectionDisplayName('Imnota / Collection 01', projectPath, ['Collection 01'])).toBe(
      'Imnota / Collection 01',
    );
    expect(collectionDisplayName('Collection 01', projectPath, ['Imnota / Collection 01'])).toBe(
      'Collection 01',
    );
  });

  it.each([
    'C:\\Users\\Example\\Documents\\Imnota\\imnota-feedback',
    '/Users/example/Imnota/imnota-feedback/',
    '\\\\server\\share\\Imnota\\imnota-feedback\\',
  ])('shortens names produced by project creation at %s', (projectPath) => {
    const project = emptyProject('Imnota Feedback', '', 'Imnota');
    const original = structuredClone(project);
    expect(collectionDisplayName(project.collections[0]!.name, projectPath)).toBe('Collection 01');
    expect(project).toEqual(original);
  });

  it('preserves custom names, unrelated prefixes and empty suffixes', () => {
    const projectPath = 'C:/Work/Imnota/imnota-feedback';
    for (const name of [
      'Checkout / Mobile',
      'Imnota / Notes',
      'imnota-feedback / Notes',
      'Other / Collection 01',
      'Imnota / ',
    ])
      expect(collectionDisplayName(name, projectPath)).toBe(name);
  });

  it('preserves a case-insensitive collision with a sibling outside the current view', () => {
    expect(collectionDisplayName('Imnota / Collection 01', '/work/Imnota/feedback', ['collection 01'])).toBe(
      'Imnota / Collection 01',
    );
  });
});
