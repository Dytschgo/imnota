import type { ProjectListItem, ProjectSnapshot } from '../../shared/types';
import { resolveRecentCollections, type RecentCollection } from '../navigation-history';

export interface CaptureDestination {
  projectPath: string;
  collectionId: string;
}

export interface CaptureDestinationChoice extends CaptureDestination {
  projectName: string;
  collectionName: string;
}

export function currentCaptureDestination(
  snapshot: ProjectSnapshot | null,
  activeCollectionId: string,
): CaptureDestination | null {
  const collection = snapshot?.project.collections.find((item) => item.id === activeCollectionId);
  if (!snapshot || !collection || collection.archived) return null;
  return { projectPath: snapshot.projectPath, collectionId: collection.id };
}

export function lastUsedCurrentDestination(
  projects: readonly ProjectListItem[],
  recentCollections: readonly RecentCollection[],
): CaptureDestination | null {
  const recent = resolveRecentCollections([...projects], [...recentCollections])[0];
  if (!recent) return null;
  return { projectPath: recent.projectPath, collectionId: recent.id };
}

export function captureDestinationChoices(
  projects: readonly ProjectListItem[],
  recentCollections: readonly RecentCollection[],
  snapshot: ProjectSnapshot | null,
): CaptureDestinationChoice[] {
  const seen = new Set<string>();
  const choices: CaptureDestinationChoice[] = [];
  const add = (projectPath: string, collectionId: string, projectName: string, collectionName: string) => {
    const key = `${projectPath}\0${collectionId}`;
    if (seen.has(key)) return;
    seen.add(key);
    choices.push({ projectPath, collectionId, projectName, collectionName });
  };
  for (const recent of resolveRecentCollections([...projects], [...recentCollections]))
    add(recent.projectPath, recent.id, recent.projectName, recent.name);
  if (snapshot && snapshot.project.status !== 'archived') {
    for (const collection of snapshot.project.collections) {
      if (!collection.archived)
        add(snapshot.projectPath, collection.id, snapshot.project.name, collection.name);
    }
  }
  return choices;
}
