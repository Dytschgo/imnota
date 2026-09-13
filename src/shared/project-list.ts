import type { LegacyProjectData } from './schema.js';
import type { ProjectData, ProjectListItem } from './types.js';

/** Display-only metadata; never use a list entry as an authoritative project document. */
export function projectListItem(
  projectPath: string,
  project: ProjectData | LegacyProjectData,
): ProjectListItem {
  const collections =
    'rounds' in project
      ? project.rounds.map((round) => ({
          id: round.id,
          name: round.name,
          archived: round.archived,
          createdAt: round.createdAt || project.createdAt,
          updatedAt: project.updatedAt,
        }))
      : project.collections;
  const searchable = [project.name, project.description, project.status];
  for (const shot of project.screenshots) searchable.push(shot.title, shot.description, shot.priority);
  if ('contentItems' in project)
    for (const item of project.contentItems ?? [])
      searchable.push(item.kind === 'drawing' ? item.title : (item.preview ?? ''));
  return {
    projectPath,
    id: project.id,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    status: project.status,
    favourite: project.favourite,
    ...('icon' in project && project.icon ? { icon: project.icon } : {}),
    collections: collections.map(({ id, name, archived, createdAt, updatedAt }) => ({
      id,
      name,
      archived,
      createdAt,
      updatedAt,
    })),
    screenshots: project.screenshots.map(({ id }) => ({ id })),
    searchText: searchable.join(' ').toLowerCase(),
  };
}
