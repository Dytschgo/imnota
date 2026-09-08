import type { AppView } from '../store';

const SESSION_KEY = 'imnota:last-session';

export interface SessionCheckpoint {
  workspacePath: string | null;
  view: AppView;
  projectPath: string | null;
  collectionId: string;
  itemId: string | null;
  search: string;
  savedAt: string;
}

export function saveSessionCheckpoint(value: SessionCheckpoint): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } catch {
    // Resume state is best effort and must never block an update.
  }
}

export function readSessionCheckpoint(): SessionCheckpoint | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SessionCheckpoint>;
    if (
      typeof value.view !== 'string' ||
      typeof value.collectionId !== 'string' ||
      typeof value.search !== 'string' ||
      typeof value.savedAt !== 'string'
    )
      return null;
    return {
      workspacePath: typeof value.workspacePath === 'string' ? value.workspacePath : null,
      view: value.view as AppView,
      projectPath: typeof value.projectPath === 'string' ? value.projectPath : null,
      collectionId: value.collectionId,
      itemId: typeof value.itemId === 'string' ? value.itemId : null,
      search: value.search,
      savedAt: value.savedAt,
    };
  } catch {
    return null;
  }
}

export function clearSessionCheckpoint(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Best effort only.
  }
}
