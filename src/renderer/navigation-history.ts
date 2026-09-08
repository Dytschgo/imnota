import type { ProjectListItem } from '../shared/types';
import type { AppView } from './store';

export interface NavigationLocation {
  view: AppView;
  projectPath: string | null;
  collectionId: string;
  itemId: string | null;
  search: string;
  settingsCategory?: string;
  scrollTop?: number;
}

export interface NavigationStack {
  back: NavigationLocation[];
  forward: NavigationLocation[];
}

export function pushNavigationLocation(
  stack: NavigationStack,
  location: NavigationLocation,
): NavigationStack {
  const current = stack.back.at(-1);
  if (current && JSON.stringify(current) === JSON.stringify(location)) return stack;
  return { back: [...stack.back, location].slice(-100), forward: [] };
}

/** Updates the active entry for local UI changes without creating a new destination. */
export function replaceNavigationLocation(
  stack: NavigationStack,
  location: NavigationLocation,
): NavigationStack {
  if (!stack.back.length) return { ...stack, back: [location] };
  return { ...stack, back: [...stack.back.slice(0, -1), location] };
}

export function moveNavigationLocation(
  stack: NavigationStack,
  direction: 'back' | 'forward',
): { stack: NavigationStack; location: NavigationLocation | null } {
  const source = direction === 'back' ? stack.back : stack.forward;
  if (source.length < 2 && direction === 'back') return { stack, location: null };
  if (!source.length && direction === 'forward') return { stack, location: null };
  if (direction === 'back') {
    const current = source.at(-1)!;
    const location = source.at(-2)!;
    return { stack: { back: source.slice(0, -1), forward: [current, ...stack.forward] }, location };
  }
  const location = source[0]!;
  return {
    stack: { back: [...stack.back, location], forward: source.slice(1) },
    location,
  };
}

export interface RecentCollection {
  projectPath: string;
  collectionId: string;
  openedAt: string;
}

export const HISTORY_KEY = 'imnota:recent-collections';
const HISTORY_LIMIT = 100;

export function readCollectionHistory(): RecentCollection[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value
      .filter((entry): entry is RecentCollection => {
        if (
          !entry ||
          typeof entry.projectPath !== 'string' ||
          !entry.projectPath ||
          typeof entry.collectionId !== 'string' ||
          !entry.collectionId ||
          typeof entry.openedAt !== 'string' ||
          !Number.isFinite(Date.parse(entry.openedAt))
        )
          return false;
        const key = JSON.stringify([entry.projectPath, entry.collectionId]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function rememberCollection(
  history: RecentCollection[],
  projectPath: string,
  collectionId: string,
  openedAt = new Date().toISOString(),
): RecentCollection[] {
  const next = [
    { projectPath, collectionId, openedAt },
    ...history.filter((entry) => entry.projectPath !== projectPath || entry.collectionId !== collectionId),
  ].slice(0, HISTORY_LIMIT);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* Navigation still works without storage. */
  }
  return next;
}

export function resolveRecentCollections(projects: ProjectListItem[], history: RecentCollection[]) {
  return history.flatMap((entry) => {
    const project = projects.find((candidate) => candidate.projectPath === entry.projectPath);
    const collection = project?.collections.find(
      (candidate) => candidate.id === entry.collectionId && !candidate.archived,
    );
    return project && project.status !== 'archived' && collection
      ? [{ ...entry, id: collection.id, name: collection.name, projectName: project.name }]
      : [];
  });
}

export function relativeOpenedTime(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (!Number.isFinite(minutes)) return 'Opened recently';
  if (minutes < 1) return 'Just opened';
  if (minutes < 60) return `Opened ${minutes}m ago`;
  if (minutes < 1440) return `Opened ${Math.floor(minutes / 60)}h ago`;
  return `Opened ${Math.floor(minutes / 1440)}d ago`;
}
