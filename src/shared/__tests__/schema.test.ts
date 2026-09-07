import { describe, expect, it } from 'vitest';
import { emptyProject } from '../utils.js';
import { validateProject } from '../schema.js';

describe('project schema', () => {
  it('accepts the versioned project shape', () => {
    expect(validateProject(emptyProject('Valid', ''))).toMatchObject({ schemaVersion: 3, name: 'Valid' });
  });
  it('rejects missing project identity', () => {
    expect(() => validateProject({ schemaVersion: 1 })).toThrow();
  });
  it('rejects two screenshot IDs that alias the same per-collection files', () => {
    const project = emptyProject('Aliased', '');
    const collectionId = project.collections[0].id;
    const screenshot = {
      collectionId,
      id: 'first',
      originalFilename: 'screen.png',
      storedFilename: 'screen.png',
      title: 'Screen',
      description: '',
      position: 0,
      createdAt: '',
      updatedAt: '',
      priority: 'medium' as const,
      annotationFile: `collections/${collectionId}/annotations/screen.png.json`,
      descriptionFile: `collections/${collectionId}/descriptions/screen.png.md`,
      originalWidth: 1,
      originalHeight: 1,
      includeInExport: true,
    };
    project.screenshots = [screenshot, { ...screenshot, id: 'second', position: 1 }];
    expect(() => validateProject(project)).toThrow(/aliased per-collection storage paths/);
  });
});
