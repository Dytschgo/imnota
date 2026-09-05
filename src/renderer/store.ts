import { create } from 'zustand';
import type {
  ProjectData,
  ProjectListItem,
  ProjectSnapshot,
  ScreenshotRecord,
  WorkspaceSettings,
} from '../shared/types';

interface AppState {
  settings: WorkspaceSettings;
  projects: ProjectListItem[];
  snapshot: ProjectSnapshot | null;
  activeScreenshotId: string | null;
  activeRoundId: string;
  exportAllRounds: boolean;
  navigationOpen: boolean;
  view: 'projects' | 'recent' | 'favourites' | 'workspace' | 'context' | 'settings';
  search: string;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  set: (patch: Partial<AppState>) => void;
  setProject: (snapshot: ProjectSnapshot | null) => void;
  updateProject: (project: ProjectData) => void;
  activeScreenshot: () => ScreenshotRecord | null;
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: {
    workspacePath: null,
    theme: 'system',
    interfaceScale: 1,
    openRecentOnLaunch: true,
    confirmBeforeDeletion: true,
  },
  projects: [],
  snapshot: null,
  activeScreenshotId: null,
  activeRoundId: '001-first-feedback',
  exportAllRounds: false,
  navigationOpen: true,
  view: 'projects',
  search: '',
  leftPanelOpen: true,
  rightPanelOpen: true,
  set: (patch) => set(patch),
  setProject: (snapshot) => {
    const roundId =
      snapshot?.project.rounds.find(
        (round) =>
          round.id === (get().snapshot?.project.id === snapshot.project.id ? get().activeRoundId : ''),
      )?.id ??
      snapshot?.project.rounds[0]?.id ??
      '001-first-feedback';
    set({
      snapshot,
      activeRoundId: roundId,
      activeScreenshotId: snapshot?.project.screenshots.find((shot) => shot.roundId === roundId)?.id ?? null,
      view: snapshot ? 'workspace' : 'projects',
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
