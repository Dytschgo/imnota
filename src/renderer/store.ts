import { create } from 'zustand';
import { orderedCollectionItems } from '../shared/content-items';
import type {
  ProjectData,
  ProjectListItem,
  ProjectSnapshot,
  ScreenshotRecord,
  WorkspaceSettings,
} from '../shared/types';

export type AppView = 'projects' | 'recent' | 'favourites' | 'workspace' | 'context' | 'settings';

interface AppState {
  settings: WorkspaceSettings;
  projects: ProjectListItem[];
  snapshot: ProjectSnapshot | null;
  activeScreenshotId: string | null;
  activeCollectionId: string;
  navigationOpen: boolean;
  view: AppView;
  search: string;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  set: (patch: Partial<AppState>) => void;
  setProject: (snapshot: ProjectSnapshot | null, selectedItemId?: string) => void;
  setActiveCollection: (collectionId: string) => void;
  updateProject: (project: ProjectData) => void;
  activeScreenshot: () => ScreenshotRecord | null;
}

function localValue(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    // Local UI preferences are best effort and never affect project data.
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: {
    workspacePath: null,
    theme: 'system',
    interfaceScale: 1,
    openRecentOnLaunch: true,
    confirmBeforeDeletion: true,
    updateChannel: 'stable',
  },
  projects: [],
  snapshot: null,
  activeScreenshotId: null,
  activeCollectionId: '001-collection',
  navigationOpen: true,
  view: 'projects',
  search: '',
  leftPanelOpen: localValue('imnota:left-panel') !== 'closed',
  rightPanelOpen: localValue('imnota:right-panel') !== 'closed',
  set: (patch) => set(patch),
  setProject: (snapshot, selectedItemId) => {
    const previous = get().snapshot;
    const sameProject = Boolean(previous && snapshot && previous.project.id === snapshot.project.id);
    const remembered = snapshot ? localValue(`imnota:last-collection:${snapshot.project.id}`) : null;
    const selectedItem = selectedItemId
      ? [...(snapshot?.project.screenshots ?? []), ...(snapshot?.project.contentItems ?? [])].find(
          (item) => item.id === selectedItemId,
        )
      : undefined;
    const collectionId =
      selectedItem?.collectionId ??
      snapshot?.project.collections.find(
        (collection) =>
          collection.id ===
          (get().snapshot?.project.id === snapshot.project.id ? get().activeCollectionId : remembered),
      )?.id ??
      [...(snapshot?.project.collections ?? [])]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .find((collection) => !collection.archived)?.id ??
      snapshot?.project.collections[0]?.id ??
      '001-collection';
    if (snapshot && selectedItem) remember(`imnota:last-collection:${snapshot.project.id}`, collectionId);
    set({
      snapshot,
      activeCollectionId: collectionId,
      activeScreenshotId:
        (snapshot ? orderedCollectionItems(snapshot.project, collectionId) : []).find(
          (shot) => shot.id === (selectedItemId ?? (sameProject ? get().activeScreenshotId : null)),
        )?.id ??
        (snapshot ? orderedCollectionItems(snapshot.project, collectionId) : [])[0]?.id ??
        null,
      view: snapshot ? 'workspace' : 'projects',
    });
  },
  setActiveCollection: (collectionId) => {
    const snapshot = get().snapshot;
    if (!snapshot?.project.collections.some((collection) => collection.id === collectionId)) return;
    remember(`imnota:last-collection:${snapshot.project.id}`, collectionId);
    set({
      activeCollectionId: collectionId,
      activeScreenshotId: orderedCollectionItems(snapshot.project, collectionId)[0]?.id ?? null,
    });
  },
  updateProject: (project) =>
    set((state) => ({
      snapshot: state.snapshot ? { ...state.snapshot, project } : null,
      projects: state.projects.map((item) =>
        item.id === project.id
          ? { ...item, ...project, projectPath: state.snapshot?.projectPath ?? item.projectPath }
          : item,
      ),
    })),
  activeScreenshot: () => {
    const state = get();
    return state.snapshot?.project.screenshots.find((shot) => shot.id === state.activeScreenshotId) ?? null;
  },
}));

useAppStore.subscribe((state, previous) => {
  if (state.leftPanelOpen !== previous.leftPanelOpen)
    remember('imnota:left-panel', state.leftPanelOpen ? 'open' : 'closed');
  if (state.rightPanelOpen !== previous.rightPanelOpen)
    remember('imnota:right-panel', state.rightPanelOpen ? 'open' : 'closed');
});
