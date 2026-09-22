import type { ProjectData } from '../src/shared/types.js';
import { validateProject } from '../src/shared/schema.js';

/** Protects native-owned content identity/files while allowing mixed order, visibility, and drawing titles. */
export function preserveMixedProjectMetadata(current: ProjectData, candidate: ProjectData): ProjectData {
  const proposedScreenshots = new Map(candidate.screenshots.map((item) => [item.id, item]));
  if (
    candidate.screenshots.length !== current.screenshots.length ||
    proposedScreenshots.size !== current.screenshots.length ||
    current.screenshots.some((item) => !proposedScreenshots.has(item.id))
  ) {
    throw new Error(
      'The screenshot list changed. Reload the project before saving. Screenshots can only be added or removed through import, capture, or Delete.',
    );
  }
  const nativeFields = [
    'collectionId',
    'storedFilename',
    'originalFilename',
    'annotationFile',
    'descriptionFile',
    'createdAt',
    'originalWidth',
    'originalHeight',
  ] as const;
  for (const screenshot of current.screenshots) {
    const proposed = proposedScreenshots.get(screenshot.id)!;
    if (nativeFields.some((field) => proposed[field] !== screenshot[field])) {
      throw new Error(
        'Screenshot identity or file locations changed. Reload the project before saving; existing files were not changed.',
      );
    }
  }
  if (current.schemaVersion === 3 && candidate.schemaVersion === 4)
    throw new Error('Only native content creation can upgrade a project to schema version 4.');
  if (current.schemaVersion === 4) {
    const proposed = candidate.schemaVersion === 4 ? candidate.contentItems : current.contentItems;
    const trusted = current.contentItems ?? [];
    if (
      !proposed ||
      proposed.length !== trusted.length ||
      proposed.some((item) => !trusted.some((entry) => entry.id === item.id))
    )
      throw new Error('Content items must be created and deleted through the native content bridge.');
    const proposedById = new Map(proposed.map((item) => [item.id, item]));
    const contentItems = trusted.map((item) => {
      const update = proposedById.get(item.id)!;
      if (
        update.kind !== item.kind ||
        update.collectionId !== item.collectionId ||
        update.createdAt !== item.createdAt ||
        (item.kind === 'drawing' &&
          (update.kind !== 'drawing' ||
            update.sourceFilename !== item.sourceFilename ||
            update.imageFilename !== item.imageFilename ||
            update.originalWidth !== item.originalWidth ||
            update.originalHeight !== item.originalHeight)) ||
        (item.kind === 'text' &&
          (update.kind !== 'text' || update.markdownFilename !== item.markdownFilename))
      )
        throw new Error(
          'Native content identity, paths, and dimensions cannot be changed by metadata saves.',
        );
      const changed =
        update.position !== item.position ||
        update.includeInExport !== item.includeInExport ||
        (item.kind === 'drawing' &&
          update.kind === 'drawing' &&
          (update.title !== item.title || (update.description ?? '') !== (item.description ?? '')));
      return item.kind === 'drawing' && update.kind === 'drawing'
        ? {
            ...item,
            title: update.title,
            description: update.description ?? '',
            position: update.position,
            includeInExport: update.includeInExport,
            updatedAt: changed ? candidate.updatedAt : item.updatedAt,
          }
        : {
            ...item,
            position: update.position,
            includeInExport: update.includeInExport,
            updatedAt: changed ? candidate.updatedAt : item.updatedAt,
          };
    });
    return validateProject({ ...candidate, schemaVersion: 4, contentItems });
  }
  return validateProject(candidate);
}
