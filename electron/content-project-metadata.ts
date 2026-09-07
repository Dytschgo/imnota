import type { ProjectData } from '../src/shared/types.js';
import { validateProject } from '../src/shared/schema.js';

/** Protects native-owned content identity/files while allowing mixed order, visibility, and drawing titles. */
export function preserveMixedProjectMetadata(current: ProjectData, candidate: ProjectData): ProjectData {
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
        (item.kind === 'drawing' && update.kind === 'drawing' && update.title !== item.title);
      return item.kind === 'drawing' && update.kind === 'drawing'
        ? {
            ...item,
            title: update.title,
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
