import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import type Konva from 'konva';
import { Check, FolderOpen, FolderPlus, Heart, Layers3, Plus, Search, ShieldCheck, X } from 'lucide-react';
import { shouldShowOnboarding } from '../shared/preferences';
import {
  formatShortcut,
  resolveShortcutBindings,
  detectShortcutPlatform,
  type ShortcutActionId,
} from '../shared/shortcuts';
import type {
  Annotation,
  ProjectData,
  ProjectListItem,
  ProjectSnapshot,
  ScreenshotRecord,
  UpdateStatus,
} from '../shared/types';
import { nowIso } from '../shared/utils';
import { orderedCollectionItems } from '../shared/content-items';
import { useContentPersistence } from './content/useContentPersistence';
import { AppDialogs, type AppDialog, type NewProjectDraft, type ProjectEditDraft } from './app/AppDialogs';
import { AppShell } from './app/AppShell';
import { useAppearance } from './app/useAppearance';
import { usePreferences } from './app/usePreferences';
import { useProjectPersistence } from './app/useProjectPersistence';
import { Workspace } from './app/Workspace';
import { liveTextColor, semanticAnnotationColor } from './canvas/annotation-layout';
import { dispatchCanvasCommand } from './canvas/commands';
import { Logo } from './components/Logo';
import type { ToolChoice } from './components/Toolbar';
import { Button, EmptyState, IconButton, Modal } from './components/ui';
import { OnboardingDemo } from './onboarding';
import { PromptBundleDialogHost } from './export/PromptBundleDialogHost';
import { usePromptBundleController } from './export/usePromptBundleController';
import { SettingsView, useKeyboardShortcuts } from './settings';
import { useAppStore, type AppView } from './store';
import {
  moveNavigationLocation,
  pushNavigationLocation,
  replaceNavigationLocation,
  resolveRecentCollections,
  relativeOpenedTime,
  type NavigationLocation,
} from './navigation-history';
import { FloatingUpdateControl } from './components/FloatingUpdateControl';
import { clearSessionCheckpoint, readSessionCheckpoint, saveSessionCheckpoint } from './app/session';
import { SearchDialog, type ProjectSearchScope, type ProjectSearchTarget } from './search';

export { CollectionControls } from './collection/CollectionRail';
export { SettingsView } from './settings/SettingsView';

interface SnapshotNotice {
  projectPath: string;
  warnings: string[];
  recoveredDeletes: Array<{ undoToken: string; screenshotId: string }>;
  recoveredContentDeletes: Array<{ undoToken: string; itemId: string }>;
}

interface SnapshotExtras {
  warnings?: string[];
  recoveredDeletes?: Array<{ undoToken: string; screenshotId: string }>;
  recoveredContentDeletes?: Array<{ undoToken: string; itemId: string }>;
}

type PendingDeletion = {
  kind: 'content' | 'screenshot';
  projectPath: string;
  itemId: string;
  title: string;
};

export default function App() {
  const store = useAppStore();
  const preferences = usePreferences();
  const appearance = useAppearance(preferences.settings.appearance, {
    performanceConstrained: preferences.performance.reducedEffectsRecommended,
  });
  const [booting, setBooting] = useState(true);
  const [dialog, setDialog] = useState<AppDialog>(null);
  const [newProject, setNewProject] = useState<NewProjectDraft>({ name: '', description: '' });
  const [editProject, setEditProject] = useState<ProjectEditDraft | null>(null);
  const [editProjectPath, setEditProjectPath] = useState<string | null>(null);
  const [editProjectRevision, setEditProjectRevision] = useState<string | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
  const [tool, setTool] = useState<ToolChoice>('select');
  const [toolColors, setToolColors] = useState<Partial<Record<ToolChoice, string>>>({});
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [history, setHistory] = useState<Annotation[][]>([]);
  const [redo, setRedo] = useState<Annotation[][]>([]);
  const [descriptionHistory, setDescriptionHistory] = useState<Record<string, string[]>>({});
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; action?: { label: string; run(): void } } | null>(
    null,
  );
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [snapshotNotice, setSnapshotNotice] = useState<SnapshotNotice | null>(null);
  const [projectSearchFocusRequest, setProjectSearchFocusRequest] = useState(0);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [searchScope, setSearchScope] = useState<ProjectSearchScope>('active');
  const [pendingSearchAnnotationId, setPendingSearchAnnotationId] = useState<string | null>(null);
  const [navigationStack, setNavigationStack] = useState({ back: [] as NavigationLocation[], forward: [] as NavigationLocation[] });
  const stageRef = useRef<Konva.Stage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectSearchInputRef = useRef<HTMLInputElement>(null);
  const metadataTimer = useRef<number | null>(null);
  const allowClose = useRef(false);
  const copiedAnnotation = useRef<Annotation | null>(null);
  const navigationIdentity = useRef(0);

  const activeShot = store.activeScreenshot();
  const adoptSnapshot = useCallback((snapshot: ProjectSnapshot, selectScreenshotId?: string) => {
    useAppStore.getState().setProject(snapshot, selectScreenshotId);
    const extras = snapshot as ProjectSnapshot & SnapshotExtras;
    setSnapshotNotice((current) => {
      const sameProject = current?.projectPath === snapshot.projectPath;
      const warnings = [...new Set([...(sameProject ? current.warnings : []), ...(extras.warnings ?? [])])];
      const recoveredByToken = new Map(
        [...(sameProject ? current.recoveredDeletes : []), ...(extras.recoveredDeletes ?? [])].map((item) => [
          item.undoToken,
          item,
        ]),
      );
      const recoveredDeletes = [...recoveredByToken.values()];
      const recoveredContentDeletes = [
        ...new Map(
          [
            ...(sameProject ? current.recoveredContentDeletes : []),
            ...(extras.recoveredContentDeletes ?? []),
          ].map((entry) => [entry.undoToken, entry]),
        ).values(),
      ];
      return warnings.length || recoveredDeletes.length || recoveredContentDeletes.length
        ? { projectPath: snapshot.projectPath, warnings, recoveredDeletes, recoveredContentDeletes }
        : null;
    });
    setError('');
  }, []);
  const persistence = useProjectPersistence({
    snapshot: store.snapshot,
    activeScreenshot: activeShot,
    onProject: useCallback((project) => useAppStore.getState().updateProject(project), []),
    onSnapshot: adoptSnapshot,
    onSelectScreenshot: useCallback((id) => useAppStore.getState().set({ activeScreenshotId: id }), []),
  });
  const contentPersistence = useContentPersistence({
    snapshot: store.snapshot,
    itemId: store.activeScreenshotId,
    beforeSave: async () => {
      if (!(await persistence.flush())) return false;
      return !persistence.hasPendingProjectMetadata() || persistence.flushProjectMetadata();
    },
    beginMutation: persistence.beginNativeMutation,
    acceptSnapshot: (snapshot, id, token) => persistence.acceptMutationSnapshot(snapshot, id, token),
    cancelMutation: persistence.cancelNativeMutation,
  });
  const getSavedPromptContext = useCallback(async () => {
    if (!(await contentPersistence.flush()))
      throw new Error('Save the current drawing or text before preparing the prompt.');
    return persistence.getSavedContext(useAppStore.getState().activeCollectionId);
  }, [persistence, contentPersistence]);
  const promptBundles = usePromptBundleController({ getSavedContext: getSavedPromptContext });
  const handlePromptAction = useCallback(
    async (action: ReturnType<typeof promptBundles.open>) => {
      const result = await action;
      if (!result.ok) setError(result.error.message);
    },
    [promptBundles],
  );

  const showToast = useCallback((message: string) => {
    setToast({ message });
    window.setTimeout(() => setToast(null), 3500);
  }, []);
  const refreshProjects = useCallback(async () => {
    useAppStore.getState().set({ projects: await window.imnota.listProjects() });
  }, []);

  useEffect(() => {
    let active = true;
    void window.imnota
      .getSettings()
      .then(async (settings) => {
        if (!active) return;
        useAppStore.getState().set({ settings });
        if (!settings.workspacePath) return;
        const projects = await window.imnota.listProjects();
        if (!active) return;
        useAppStore.getState().set({ projects });
        const checkpoint = readSessionCheckpoint();
        const validCheckpoint =
          checkpoint &&
          checkpoint.workspacePath === settings.workspacePath &&
          Number.isFinite(Date.parse(checkpoint.savedAt))
            ? checkpoint
            : null;
        const savedProject = validCheckpoint?.projectPath
          ? projects.find((project) => project.projectPath === validCheckpoint.projectPath)
          : undefined;
        if (validCheckpoint && savedProject && ['workspace', 'context'].includes(validCheckpoint.view)) {
          const restoredSnapshot = await window.imnota.loadProject(savedProject.projectPath);
          if (!active) return;
          adoptSnapshot(restoredSnapshot, validCheckpoint.itemId ?? undefined);
          const restored = useAppStore.getState();
          if (
            validCheckpoint.collectionId &&
            restored.snapshot?.project.collections.some((item) => item.id === validCheckpoint.collectionId)
          ) {
            restored.setActiveCollection(validCheckpoint.collectionId);
            if (
              validCheckpoint.itemId &&
              restored.snapshot &&
              orderedCollectionItems(restored.snapshot.project, validCheckpoint.collectionId).some(
                (item) => item.id === validCheckpoint.itemId,
              )
            )
              restored.set({ activeScreenshotId: validCheckpoint.itemId });
          }
          restored.set({ view: validCheckpoint.view, search: validCheckpoint.search });
        } else if (
          validCheckpoint &&
          ['projects', 'recent', 'favourites', 'settings'].includes(validCheckpoint.view)
        ) {
          useAppStore.getState().set({ view: validCheckpoint.view, search: validCheckpoint.search });
        } else if (settings.openRecentOnLaunch && projects[0]) {
          const recent = resolveRecentCollections(projects, useAppStore.getState().recentCollections)[0];
          const snapshot = await window.imnota.loadProject(recent?.projectPath ?? projects[0].projectPath);
          if (!active) return;
          adoptSnapshot(snapshot);
          if (recent) useAppStore.getState().setActiveCollection(recent.id);
          else useAppStore.getState().recordCollectionOpen();
        }
        if (checkpoint) clearSessionCheckpoint();
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Imnota could not start.'))
      .finally(() => active && setBooting(false));
    return () => {
      active = false;
    };
  }, [adoptSnapshot]);

  useEffect(() => {
    if (
      preferences.result &&
      shouldShowOnboarding(preferences.result.settings.onboarding, preferences.result.profile)
    )
      setShowOnboarding(true);
  }, [preferences.result]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${store.settings.interfaceScale * 100}%`;
  }, [store.settings.interfaceScale]);

  useEffect(() => {
    const unsubscribe = window.imnota.onUpdateStatus((status) => {
      if (status.state !== 'downloaded' || status.installing !== true) allowClose.current = false;
      setUpdateStatus(status);
    });
    void window.imnota
      .getUpdateStatus()
      .then(setUpdateStatus)
      .catch(() => undefined);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (persistence.hasUnsavedChanges || contentPersistence.hasUnsavedChanges) allowClose.current = false;
  }, [persistence.hasUnsavedChanges, contentPersistence.hasUnsavedChanges]);

  useEffect(() => {
    setHistory([]);
    setRedo([]);
    setSelectedAnnotationId(null);
  }, [persistence.loadedScreenshotId]);

  useEffect(() => {
    if (!projectSearchFocusRequest || !['projects', 'recent', 'favourites'].includes(store.view)) return;
    const frame = window.requestAnimationFrame(() => {
      projectSearchInputRef.current?.focus();
      projectSearchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [projectSearchFocusRequest, store.view]);

  const flushAll = useCallback(async (): Promise<boolean> => {
    if (metadataTimer.current !== null) {
      window.clearTimeout(metadataTimer.current);
      metadataTimer.current = null;
    }
    if (!(await contentPersistence.flush())) return false;
    if (!(await persistence.flush())) return false;
    if (persistence.hasPendingProjectMetadata() && !(await persistence.flushProjectMetadata())) return false;
    return true;
  }, [persistence, contentPersistence]);

  const currentLocation = useCallback((): NavigationLocation => {
    const current = useAppStore.getState();
    return {
      view: current.view,
      projectPath: current.snapshot?.projectPath ?? null,
      collectionId: current.activeCollectionId,
      itemId: current.activeScreenshotId,
      search: current.search,
      scrollTop: document.querySelector<HTMLElement>('.library, [data-testid="settings-view"], .workspace')
        ?.scrollTop,
    };
  }, []);

  const installUpdate = useCallback(async (): Promise<void> => {
    if (!(await flushAll())) return;
    allowClose.current = true;
    try {
      await window.imnota.installUpdate();
    } catch (reason) {
      // A rejected native handoff leaves the app open, so future closes must flush again.
      allowClose.current = false;
      throw reason;
    }
  }, [flushAll]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (allowClose.current || (!persistence.hasUnsavedChanges && !contentPersistence.hasUnsavedChanges))
        return;
      event.preventDefault();
      event.returnValue = '';
      void flushAll().then((saved) => {
        if (saved) {
          allowClose.current = true;
          window.close();
        }
      });
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [flushAll, persistence.hasUnsavedChanges, contentPersistence.hasUnsavedChanges]);

  const queueProjectSave = useCallback(
    (project: ProjectData, changedShot?: ScreenshotRecord) => {
      if (changedShot) {
        useAppStore.getState().updateProject(project);
        persistence.markScreenshotDirty(changedShot);
        return;
      }
      // Queue the concrete edit before any asynchronous save can publish an older snapshot.
      persistence.queueProjectMetadata(project);
      useAppStore.getState().updateProject(project);
      if (metadataTimer.current !== null) window.clearTimeout(metadataTimer.current);
      metadataTimer.current = window.setTimeout(() => {
        metadataTimer.current = null;
        void persistence.flushProjectMetadata();
      }, 700);
    },
    [persistence],
  );

  const updateShot = useCallback(
    (patch: Partial<ScreenshotRecord>) => {
      const current = useAppStore.getState();
      const shot = current.activeScreenshot();
      if (!current.snapshot || !shot) return;
      const nextShot = { ...shot, ...patch, updatedAt: nowIso() };
      queueProjectSave(
        {
          ...current.snapshot.project,
          updatedAt: nowIso(),
          screenshots: current.snapshot.project.screenshots.map((item) =>
            item.id === shot.id ? nextShot : item,
          ),
        },
        nextShot,
      );
    },
    [queueProjectSave],
  );

  const changeAnnotations = useCallback(
    (next: Annotation[]) => {
      setHistory((items) => [...items, persistence.annotations]);
      setRedo([]);
      persistence.changeAnnotations(next);
    },
    [persistence],
  );
  const undoAnnotations = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    setRedo((items) => [...items, persistence.annotations]);
    persistence.changeAnnotations(previous);
    setHistory((items) => items.slice(0, -1));
  }, [history, persistence]);
  const redoAnnotations = useCallback(() => {
    const next = redo.at(-1);
    if (!next) return;
    setHistory((items) => [...items, persistence.annotations]);
    persistence.changeAnnotations(next);
    setRedo((items) => items.slice(0, -1));
  }, [persistence, redo]);
  function changeDescription(value: string) {
    if (!activeShot || value === activeShot.description) return;
    setDescriptionHistory((items) => ({
      ...items,
      [activeShot.id]: [...(items[activeShot.id] ?? []), activeShot.description],
    }));
    updateShot({ description: value });
  }
  function undoDescription() {
    if (!activeShot) return;
    const values = descriptionHistory[activeShot.id] ?? [];
    const previous = values.at(-1);
    if (previous === undefined) return;
    setDescriptionHistory((items) => ({ ...items, [activeShot.id]: values.slice(0, -1) }));
    updateShot({ description: previous });
  }

  const guardedSnapshot = useCallback(
    async (action: () => Promise<ProjectSnapshot | null | undefined>, failure: string, recordOpen = true) => {
      const identity = ++navigationIdentity.current;
      if (!(await flushAll())) {
        setError(`${failure} was cancelled so your unsaved work stays open.`);
        return false;
      }
      const nativeMutationToken = persistence.beginNativeMutation();
      try {
        const next = await action();
        if (identity !== navigationIdentity.current) {
          await persistence.cancelNativeMutation(nativeMutationToken);
          return false;
        }
        if (next) {
          if (!(await persistence.adoptAuthoritativeSnapshot(next, nativeMutationToken))) {
            setError(`${failure} could not safely adopt the latest project state.`);
            return false;
          }
          if (identity !== navigationIdentity.current) return false;
          if (recordOpen) useAppStore.getState().recordCollectionOpen();
          return true;
        }
        await persistence.cancelNativeMutation(nativeMutationToken);
        return false;
      } catch (reason) {
        await persistence.cancelNativeMutation(nativeMutationToken);
        if (identity === navigationIdentity.current)
          setError(reason instanceof Error ? reason.message : failure);
        return false;
      }
    },
    [flushAll, persistence],
  );

  async function beginCurrentProjectMutation(): Promise<number | null> {
    if (!(await flushAll())) return null;
    return persistence.beginNativeMutation();
  }

  async function navigate(view: AppView) {
    const identity = ++navigationIdentity.current;
    const previousLocation = currentLocation();
    if (!(await flushAll())) {
      setError('Navigation was cancelled so your unsaved work stays open.');
      return;
    }
    try {
      const opensLibrary = ['projects', 'recent', 'favourites', 'archived'].includes(view);
      if (opensLibrary) await refreshProjects();
      if (identity !== navigationIdentity.current) return;
      if (!(await flushAll())) {
        setError('Navigation was cancelled because newer edits could not be saved.');
        return;
      }
      const state = useAppStore.getState();
      const currentIsLibrary = ['projects', 'recent', 'favourites', 'archived'].includes(state.view) && !state.snapshot;
      state.set({
        view,
        snapshot: opensLibrary || view === 'settings' ? null : state.snapshot,
        search: opensLibrary && !currentIsLibrary ? '' : state.search,
      });
      setNavigationStack((stack) =>
        pushNavigationLocation(replaceNavigationLocation(stack, previousLocation), currentLocation()),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The project library could not be refreshed.');
    }
  }

  async function restoreNavigation(direction: 'back' | 'forward') {
    let candidateStack = replaceNavigationLocation(navigationStack, currentLocation());
    let moved = moveNavigationLocation(candidateStack, direction);
    if (!moved.location) return;
    const identity = ++navigationIdentity.current;
    if (!(await flushAll())) {
      setError('Navigation was cancelled so your unsaved work stays open.');
      return;
    }
    try {
      while (moved.location) {
        const target = moved.location;
        if (target.projectPath && ['workspace', 'context'].includes(target.view)) {
        const project = useAppStore
          .getState()
          .projects.find((candidate) => candidate.projectPath === target.projectPath);
        if (!project || project.status === 'archived') {
          candidateStack = moved.stack;
          moved = moveNavigationLocation(candidateStack, direction);
          continue;
        }
        const nativeMutationToken = persistence.beginNativeMutation();
        let adopted = false;
        let snapshot: ProjectSnapshot;
        try {
          snapshot = await window.imnota.loadProject(target.projectPath);
        } catch (reason) {
          await persistence.cancelNativeMutation(nativeMutationToken);
          if (reason instanceof Error && /(enoent|not found|missing)/i.test(reason.message)) {
            candidateStack = moved.stack;
            moved = moveNavigationLocation(candidateStack, direction);
            continue;
          }
          throw reason;
        }
        if (identity !== navigationIdentity.current) {
          await persistence.cancelNativeMutation(nativeMutationToken);
          return;
        }
        const collection = snapshot.project.collections.find((entry) => entry.id === target.collectionId);
        if (!collection) {
          await persistence.cancelNativeMutation(nativeMutationToken);
          candidateStack = moved.stack;
          moved = moveNavigationLocation(candidateStack, direction);
          continue;
        }
        adopted = await persistence.adoptAuthoritativeSnapshot(snapshot, nativeMutationToken);
        if (!adopted) return;
        if (identity !== navigationIdentity.current) return;
        const state = useAppStore.getState();
        state.setActiveCollection(collection.id);
        if (
          target.itemId &&
          orderedCollectionItems(snapshot.project, collection.id).some((item) => item.id === target.itemId)
        )
          state.set({ activeScreenshotId: target.itemId });
        useAppStore.getState().set({ view: target.view, search: target.search });
        } else {
        if (['projects', 'recent', 'favourites', 'archived'].includes(target.view)) await refreshProjects();
        if (identity !== navigationIdentity.current) return;
        useAppStore.getState().set({ view: target.view, snapshot: null, search: target.search });
        }
        setNavigationStack(moved.stack);
        if (target.scrollTop !== undefined)
          window.requestAnimationFrame(() => {
            const container = document.querySelector<HTMLElement>('.library, [data-testid="settings-view"], .workspace');
            if (container) container.scrollTop = target.scrollTop!;
          });
        return;
      }
      setNavigationStack(candidateStack);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The saved location is no longer available.');
    }
  }

  async function chooseWorkspace() {
    try {
      const settings = await window.imnota.chooseWorkspace();
      if (!settings) return false;
      store.set({ settings, projects: await window.imnota.listProjects() });
      showToast('Workspace ready');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Workspace could not be selected.');
      return false;
    }
  }
  async function createProject() {
    if (!newProject.name.trim()) return;
    const previousLocation = currentLocation();
    if (!(await flushAll())) {
      setError('Project creation was cancelled so your unsaved work stays open.');
      return;
    }
    setDialogBusy(true);
    try {
      if (!store.settings.workspacePath && !(await chooseWorkspace())) return;
      const snapshot = await window.imnota.createProject(newProject);
      if (!(await flushAll())) {
        setError(
          'The project was created, but the current project stayed open because newer edits could not be saved.',
        );
        return;
      }
      setDialog(null);
      setNewProject({ name: '', description: '' });
      await refreshProjects();
      adoptSnapshot(snapshot);
      useAppStore.getState().recordCollectionOpen();
      setNavigationStack((stack) =>
        pushNavigationLocation(replaceNavigationLocation(stack, previousLocation), currentLocation()),
      );
      showToast('Project created');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Project could not be created.');
    } finally {
      setDialogBusy(false);
    }
  }

  async function importPaths(paths: string[]) {
    const current = useAppStore.getState();
    if (!current.snapshot || !paths.length) return;
    const nativeMutationToken = await beginCurrentProjectMutation();
    if (nativeMutationToken === null) return;
    try {
      const existingIds = new Set(current.snapshot.project.screenshots.map((shot) => shot.id));
      const snapshot = await window.imnota.importImageFiles({
        projectPath: current.snapshot.projectPath,
        collectionId: current.activeCollectionId,
        paths,
      });
      const newest = snapshot.project.screenshots
        .filter((shot) => shot.collectionId === current.activeCollectionId && !existingIds.has(shot.id))
        .sort((left, right) => left.position - right.position)
        .at(-1);
      if (!(await persistence.acceptMutationSnapshot(snapshot, newest?.id, nativeMutationToken))) return;
      await refreshProjects();
      showToast(`${paths.length} screenshot${paths.length === 1 ? '' : 's'} added`);
    } catch (reason) {
      await persistence.cancelNativeMutation(nativeMutationToken);
      setError(reason instanceof Error ? reason.message : 'The screenshots could not be imported.');
    }
  }
  async function pasteImage() {
    const current = useAppStore.getState();
    if (!current.snapshot) return;
    const nativeMutationToken = await beginCurrentProjectMutation();
    if (nativeMutationToken === null) return;
    try {
      const existingIds = new Set(current.snapshot.project.screenshots.map((shot) => shot.id));
      const snapshot = await window.imnota.pasteImage(
        current.snapshot.projectPath,
        current.activeCollectionId,
      );
      if (
        !(await persistence.acceptMutationSnapshot(
          snapshot,
          snapshot.project.screenshots.find((shot) => !existingIds.has(shot.id))?.id,
          nativeMutationToken,
        ))
      )
        return;
      await refreshProjects();
      showToast('Screenshot pasted');
    } catch (reason) {
      await persistence.cancelNativeMutation(nativeMutationToken);
      setError(reason instanceof Error ? reason.message : 'The clipboard does not contain an image.');
    }
  }
  async function selectShot(id: string) {
    const previousLocation = currentLocation();
    if (id !== store.activeScreenshotId && (await flushAll())) {
      useAppStore.getState().set({ activeScreenshotId: id });
      setNavigationStack((stack) =>
        pushNavigationLocation(replaceNavigationLocation(stack, previousLocation), currentLocation()),
      );
    }
  }
  async function addContent(kind: 'drawing' | 'text') {
    const token = await beginCurrentProjectMutation();
    if (token === null) return;
    try {
      const current = useAppStore.getState();
      if (!current.snapshot) {
        await persistence.cancelNativeMutation(token);
        return;
      }
      const existing = new Set(current.snapshot.project.contentItems?.map((item) => item.id));
      const snapshot = await window.imnota.createContentItem({
        projectPath: current.snapshot.projectPath,
        collectionId: current.activeCollectionId,
        kind,
      });
      const created = snapshot.project.contentItems?.find((item) => !existing.has(item.id));
      if (!(await persistence.acceptMutationSnapshot(snapshot, created?.id, token))) return;
    } catch (reason) {
      await persistence.cancelNativeMutation(token);
      setError(reason instanceof Error ? reason.message : 'The item could not be created.');
    }
  }
  async function mutateContent(action: 'duplicate' | 'delete', pending?: PendingDeletion) {
    const token = await beginCurrentProjectMutation();
    if (token === null) return;
    try {
      const current = useAppStore.getState();
      const itemId = pending?.itemId ?? current.activeScreenshotId;
      const item = current.snapshot?.project.contentItems?.find((entry) => entry.id === itemId);
      if (!current.snapshot || !item || (pending && current.snapshot.projectPath !== pending.projectPath)) {
        await persistence.cancelNativeMutation(token);
        return;
      }
      const input = { projectPath: current.snapshot.projectPath, itemId: item.id };
      if (action === 'duplicate') {
        const existing = new Set(current.snapshot.project.contentItems?.map((entry) => entry.id));
        const snapshot = await window.imnota.duplicateContentItem(input);
        const copy = snapshot.project.contentItems?.find((entry) => !existing.has(entry.id));
        if (!(await persistence.acceptMutationSnapshot(snapshot, copy?.id, token))) return;
      } else {
        const result = await window.imnota.deleteContentItem(input);
        if (!(await persistence.acceptMutationSnapshot(result.snapshot, undefined, token))) return;
        setToast({
          message: `${item.kind === 'drawing' ? 'Drawing' : 'Text block'} moved to trash.`,
          action: {
            label: 'Undo',
            run: () => {
              void undoContent(input.projectPath, result.undoToken, item.id);
            },
          },
        });
      }
    } catch (reason) {
      await persistence.cancelNativeMutation(token);
      setError(
        reason instanceof Error
          ? reason.message
          : `The item could not be ${action === 'delete' ? 'deleted' : 'duplicated'}.`,
      );
    }
  }
  async function requestContentDeletion() {
    if (!(await flushAll())) return;
    const current = useAppStore.getState();
    const item = current.snapshot?.project.contentItems?.find(
      (entry) => entry.id === current.activeScreenshotId,
    );
    if (!current.snapshot || !item) return;
    const pending = {
      kind: 'content' as const,
      projectPath: current.snapshot.projectPath,
      itemId: item.id,
      title: item.kind === 'drawing' ? item.title : 'Text block',
    };
    if (store.settings.confirmBeforeDeletion) {
      setPendingDeletion(pending);
      return;
    }
    await mutateContent('delete', pending);
  }
  async function undoContent(projectPath: string, undoToken: string, itemId: string) {
    const token = await beginCurrentProjectMutation();
    if (token === null) return;
    try {
      const snapshot = await window.imnota.undoDeleteContentItem({ projectPath, undoToken });
      if (!(await persistence.acceptMutationSnapshot(snapshot, itemId, token))) return;
      setSnapshotNotice((notice) =>
        notice
          ? {
              ...notice,
              recoveredContentDeletes: notice.recoveredContentDeletes.filter(
                (entry) => entry.undoToken !== undoToken,
              ),
            }
          : null,
      );
    } catch (reason) {
      await persistence.cancelNativeMutation(token);
      setError(reason instanceof Error ? reason.message : 'The item could not be restored.');
    }
  }
  async function selectCollection(id: string, navigationIdentityAtStart?: number) {
    const identity = navigationIdentityAtStart ?? ++navigationIdentity.current;
    if (identity !== navigationIdentity.current) return;
    const before = useAppStore.getState();
    if (id !== before.activeCollectionId && (await flushAll())) {
      if (
        identity !== navigationIdentity.current ||
        before.snapshot?.projectPath !== useAppStore.getState().snapshot?.projectPath
      )
        return;
      useAppStore.getState().setActiveCollection(id);
    }
  }
  async function openCollection(projectPath: string, collectionId: string) {
    const previousLocation = currentLocation();
    if (
      !(await guardedSnapshot(() => window.imnota.loadProject(projectPath), 'Opening the collection', false))
    )
      return;
    const requestIdentity = navigationIdentity.current;
    const current = useAppStore.getState();
    if (current.snapshot?.projectPath === projectPath) {
      await selectCollection(collectionId, requestIdentity);
      const selected = useAppStore.getState();
      if (
        requestIdentity === navigationIdentity.current &&
        selected.snapshot?.projectPath === projectPath &&
        selected.activeCollectionId === collectionId
      )
        selected.recordCollectionOpen();
      setNavigationStack((stack) =>
        pushNavigationLocation(replaceNavigationLocation(stack, previousLocation), currentLocation()),
      );
    }
  }
  async function openProject(projectPath: string) {
    const previousLocation = currentLocation();
    if (!(await guardedSnapshot(() => window.imnota.loadProject(projectPath), 'Opening the project'))) return;
    setNavigationStack((stack) =>
      pushNavigationLocation(replaceNavigationLocation(stack, previousLocation), currentLocation()),
    );
  }
  async function openProjectDialog() {
    const previousLocation = currentLocation();
    if (!(await guardedSnapshot(() => window.imnota.openProjectDialog(), 'Opening the project'))) return;
    setNavigationStack((stack) =>
      pushNavigationLocation(replaceNavigationLocation(stack, previousLocation), currentLocation()),
    );
  }
  async function duplicateScreenshot() {
    const current = useAppStore.getState();
    const shot = current.activeScreenshot();
    if (!current.snapshot || !shot) return;
    const nativeMutationToken = await beginCurrentProjectMutation();
    if (nativeMutationToken === null) return;
    try {
      const existing = new Set(current.snapshot.project.screenshots.map((item) => item.id));
      const snapshot = await window.imnota.duplicateScreenshot({
        projectPath: current.snapshot.projectPath,
        screenshot: shot,
      });
      if (
        !(await persistence.acceptMutationSnapshot(
          snapshot,
          snapshot.project.screenshots.find((item) => !existing.has(item.id))?.id,
          nativeMutationToken,
        ))
      )
        return;
    } catch (reason) {
      await persistence.cancelNativeMutation(nativeMutationToken);
      setError(reason instanceof Error ? reason.message : 'The screenshot could not be duplicated.');
    }
  }
  async function requestScreenshotDeletion() {
    if (!(await flushAll())) return;
    const current = useAppStore.getState();
    const shot = current.activeScreenshot();
    if (!current.snapshot || !shot) return;
    const pending = {
      kind: 'screenshot' as const,
      projectPath: current.snapshot.projectPath,
      itemId: shot.id,
      title: shot.title,
    };
    if (store.settings.confirmBeforeDeletion) {
      setPendingDeletion(pending);
      return;
    }
    await deleteScreenshotNow(pending);
  }
  async function deleteScreenshotNow(pending: PendingDeletion) {
    const current = useAppStore.getState();
    const shot = current.snapshot?.project.screenshots.find((entry) => entry.id === pending.itemId);
    if (!current.snapshot || current.snapshot.projectPath !== pending.projectPath || !shot) return;
    const nativeMutationToken = await beginCurrentProjectMutation();
    if (nativeMutationToken === null) return;
    try {
      const latest = useAppStore.getState();
      if (
        latest.snapshot?.projectPath !== pending.projectPath ||
        !latest.snapshot.project.screenshots.some((item) => item.id === pending.itemId)
      ) {
        await persistence.cancelNativeMutation(nativeMutationToken);
        return;
      }
      const result = await window.imnota.deleteScreenshot({
        projectPath: current.snapshot.projectPath,
        screenshotId: shot.id,
      });
      if (!(await persistence.acceptMutationSnapshot(result.snapshot, undefined, nativeMutationToken)))
        return;
      setToast({
        message: 'Screenshot moved to trash.',
        action: {
          label: 'Undo',
          run: () => void undoDeletedScreenshot(current.snapshot!.projectPath, result.undoToken, shot.id),
        },
      });
    } catch (reason) {
      await persistence.cancelNativeMutation(nativeMutationToken);
      setError(reason instanceof Error ? reason.message : 'The screenshot could not be moved to trash.');
    }
  }
  async function undoDeletedScreenshot(projectPath: string, undoToken: string, screenshotId: string) {
    const nativeMutationToken = await beginCurrentProjectMutation();
    if (nativeMutationToken === null) return;
    try {
      const restored = await window.imnota.undoDeleteScreenshot({ projectPath, undoToken });
      await persistence.acceptMutationSnapshot(restored, screenshotId, nativeMutationToken);
    } catch (reason) {
      await persistence.cancelNativeMutation(nativeMutationToken);
      setError(reason instanceof Error ? reason.message : 'The screenshot could not be restored.');
    }
  }
  async function deleteProject() {
    if (!store.snapshot || !(await flushAll())) return;
    setDialogBusy(true);
    try {
      await window.imnota.deleteProject(store.snapshot.projectPath);
      setDialog(null);
      store.setProject(null);
      await refreshProjects();
      showToast('Project moved to the system trash');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The project could not be deleted.');
    } finally {
      setDialogBusy(false);
    }
  }
  async function beginProjectEdit(projectPath: string) {
    if (!(await flushAll())) return;
    const snapshot = await window.imnota.loadProject(projectPath);
    if (!snapshot.projectRevision) { setError('Project metadata cannot be edited until its revision is available.'); return; }
    setEditProjectPath(projectPath);
    setEditProjectRevision(snapshot.projectRevision);
    setEditProject({ name: snapshot.project.name, description: snapshot.project.description, icon: (snapshot.project as typeof snapshot.project & { icon?: ProjectEditDraft['icon'] }).icon ?? 'layers' });
    setDialog('edit-project');
  }
  async function saveProjectEdits() {
    if (!editProject || !editProjectPath || !editProjectRevision) return;
    setDialogBusy(true);
    try {
      const result = await window.imnota.updateProjectMetadata({
        projectPath: editProjectPath,
        expectedRevision: editProjectRevision,
        patch: editProject,
      });
      if (useAppStore.getState().snapshot?.projectPath === editProjectPath) adoptSnapshot(result);
      await refreshProjects();
      setDialog(null); setEditProject(null); showToast('Project details saved');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Project details could not be saved.'); }
    finally { setDialogBusy(false); }
  }
  async function setProjectArchived(projectPath: string, archived: boolean, expectedRevision?: string) {
    if (!(await flushAll())) return;
    try {
      const loaded = expectedRevision ? null : await window.imnota.loadProject(projectPath);
      const revision = expectedRevision ?? loaded?.projectRevision;
      if (!revision) throw new Error('Project revision is unavailable.');
      const result = await window.imnota.setProjectArchived({ projectPath, expectedRevision: revision, archived });
      if (useAppStore.getState().snapshot?.projectPath === projectPath) useAppStore.getState().setProject(null);
      await refreshProjects();
      showToast(archived ? 'Project archived' : 'Project restored');
      if (archived && result.projectRevision) setToast({ message: 'Project archived', action: { label: 'Undo', run: () => void setProjectArchived(projectPath, false, result.projectRevision) } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Project archive state could not be changed.'); }
  }

  const checkpointSession = useCallback(() => {
    const current = useAppStore.getState();
    saveSessionCheckpoint({
      workspacePath: current.settings.workspacePath,
      view: current.view,
      projectPath: current.snapshot?.projectPath ?? null,
      collectionId: current.activeCollectionId,
      itemId: current.activeScreenshotId,
      search: current.search,
      savedAt: new Date().toISOString(),
    });
  }, []);
  async function downloadUpdate() {
    if (!(await flushAll())) return;
    checkpointSession();
    try {
      await window.imnota.downloadUpdate();
    } catch {
      clearSessionCheckpoint();
      setError('The update could not be downloaded.');
    }
  }
  async function restoreRecoveredDelete(undoToken: string, screenshotId: string) {
    const current = useAppStore.getState().snapshot;
    if (!current) return;
    const nativeMutationToken = await beginCurrentProjectMutation();
    if (nativeMutationToken === null) return;
    try {
      const restored = await window.imnota.undoDeleteScreenshot({
        projectPath: current.projectPath,
        undoToken,
      });
      if (!(await persistence.acceptMutationSnapshot(restored, screenshotId, nativeMutationToken))) return;
      setSnapshotNotice((notice) => {
        if (!notice) return null;
        const recoveredDeletes = notice.recoveredDeletes.filter((item) => item.undoToken !== undoToken);
        return notice.warnings.length || recoveredDeletes.length ? { ...notice, recoveredDeletes } : null;
      });
      showToast('Recovered screenshot restored');
    } catch (reason) {
      await persistence.cancelNativeMutation(nativeMutationToken);
      setError(reason instanceof Error ? reason.message : 'The recovered screenshot could not be restored.');
    }
  }
  async function toggleFavourite() {
    if (!store.snapshot) return;
    queueProjectSave({
      ...store.snapshot.project,
      favourite: !store.snapshot.project.favourite,
      updatedAt: nowIso(),
    });
  }
  async function openProjectSearch() {
    if (!store.settings.workspacePath) {
      setError('Choose a workspace before searching projects.');
      return;
    }
    if (!(await flushAll())) return;
    setPendingSearchAnnotationId(null);
    setSearchDialogOpen(true);
  }
  async function openSearchTarget(target: ProjectSearchTarget) {
    const previousLocation = currentLocation();
    if (!(await guardedSnapshot(() => window.imnota.loadProject(target.projectPath), 'Opening the search result', false)))
      throw new Error('The result could not be opened.');
    const state = useAppStore.getState();
    if (target.collectionId && state.snapshot?.project.collections.some((entry) => entry.id === target.collectionId))
      state.setActiveCollection(target.collectionId);
    if (target.itemId && state.snapshot && orderedCollectionItems(state.snapshot.project, state.activeCollectionId).some((item) => item.id === target.itemId))
      state.set({ activeScreenshotId: target.itemId });
    setSelectedAnnotationId(target.annotationId ?? null);
    setPendingSearchAnnotationId(target.annotationId ?? null);
    setNavigationStack((stack) => pushNavigationLocation(replaceNavigationLocation(stack, previousLocation), currentLocation()));
  }

  const platform = detectShortcutPlatform();
  const resolvedShortcuts = useMemo(
    () => resolveShortcutBindings(preferences.settings.shortcuts.bindings, platform),
    [platform, preferences.settings.shortcuts.bindings],
  );
  const shortcutLabel = useCallback(
    (id: ShortcutActionId) => formatShortcut(resolvedShortcuts[id], platform),
    [platform, resolvedShortcuts],
  );
  const orderedShots = useMemo(
    () => (store.snapshot ? orderedCollectionItems(store.snapshot.project, store.activeCollectionId) : []),
    [store.activeCollectionId, store.snapshot],
  );
  const handlers: Partial<Record<ShortcutActionId, (event: KeyboardEvent) => void>> = {
    'project.new': () => setDialog('new-project'),
    'project.open': () =>
      void guardedSnapshot(() => window.imnota.openProjectDialog(), 'Opening the project'),
    'project.search': () => void openProjectSearch(),
    'navigation.projects': () => void navigate('projects'),
    'navigation.recent': () => void navigate('recent'),
    'navigation.favourites': () => void navigate('favourites'),
    'edit.save': () => void flushAll(),
    'edit.undo': undoAnnotations,
    'edit.redo': redoAnnotations,
    'edit.copyAnnotation': () => {
      copiedAnnotation.current = structuredClone(
        persistence.annotations.find((item) => item.id === selectedAnnotationId) ?? null,
      );
      if (copiedAnnotation.current) showToast('Annotation copied inside Imnota.');
    },
    'edit.paste': () => {
      if (copiedAnnotation.current) {
        const copy = {
          ...copiedAnnotation.current,
          id: crypto.randomUUID(),
          x: copiedAnnotation.current.x + 16,
          y: copiedAnnotation.current.y + 16,
          zIndex: persistence.annotations.length,
        };
        changeAnnotations([...persistence.annotations, copy]);
        setSelectedAnnotationId(copy.id);
      } else void pasteImage();
    },
    'edit.deleteAnnotation': () => {
      if (selectedAnnotationId) {
        changeAnnotations(persistence.annotations.filter((item) => item.id !== selectedAnnotationId));
        setSelectedAnnotationId(null);
      }
    },
    'tool.select': () => setTool('select'),
    'tool.text': () => setTool('text'),
    'tool.arrow': () => setTool('arrow'),
    'tool.rectangle': () => setTool('rectangle'),
    'tool.highlight': () => setTool('highlight'),
    'tool.step': () => setTool('step'),
    'screenshot.previous': () => {
      const index = orderedShots.findIndex((item) => item.id === store.activeScreenshotId);
      if (index > 0) void selectShot(orderedShots[index - 1]!.id);
    },
    'screenshot.next': () => {
      const index = orderedShots.findIndex((item) => item.id === store.activeScreenshotId);
      if (index >= 0 && index < orderedShots.length - 1) void selectShot(orderedShots[index + 1]!.id);
    },
    'screenshot.toggleExport': () =>
      activeShot && updateShot({ includeInExport: !activeShot.includeInExport }),
    'prompt.copy': () => void handlePromptAction(promptBundles.copyFresh(1)),
    'panel.toggleCollections': () => store.set({ leftPanelOpen: !store.leftPanelOpen }),
    'panel.toggleInspector': () => store.set({ rightPanelOpen: !store.rightPanelOpen }),
    'canvas.fit': () => dispatchCanvasCommand(stageRef.current, 'fit'),
    'canvas.actualSize': () => dispatchCanvasCommand(stageRef.current, 'actual-size'),
    'collection.new': () =>
      document.querySelector<HTMLButtonElement>('[data-testid="new-collection"]')?.click(),
    'collection.overallContext': () => {
      const details = document.querySelector<HTMLDetailsElement>('.collection-context');
      if (details) details.open = true;
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Overall context"]')?.focus();
    },
  };
  // The drawing editor owns its canvas shortcuts; global navigation remains available elsewhere.
  useKeyboardShortcuts({ bindings: preferences.settings.shortcuts.bindings, handlers });

  if (booting || preferences.loading)
    return (
      <div className="boot-screen">
        <Logo />
        <span>Preparing your workspace…</span>
      </div>
    );
  const visibleError = error || contentPersistence.error || persistence.error || preferences.error;
  const creationColorTool: ToolChoice = tool === 'select' ? 'text' : tool;
  const creationKind: Annotation['kind'] = creationColorTool === 'eraser' ? 'arrow' : creationColorTool;
  const annotationColor =
    toolColors[creationColorTool] ?? semanticAnnotationColor(creationKind, appearance.theme);
  const selectedAnnotation = persistence.annotations.find((item) => item.id === selectedAnnotationId);
  const paletteColor = selectedAnnotation
    ? selectedAnnotation.kind === 'text'
      ? liveTextColor(selectedAnnotation.fill ?? selectedAnnotation.stroke, appearance.theme)
      : ((selectedAnnotation.fill === 'transparent' ? selectedAnnotation.stroke : selectedAnnotation.fill) ??
        semanticAnnotationColor(selectedAnnotation.kind, appearance.theme))
    : annotationColor;
  return (
    <>
      <AppShell
        searchShortcut={shortcutLabel('project.search')}
        navigationShortcuts={{
          projects: shortcutLabel('navigation.projects'),
          recent: shortcutLabel('navigation.recent'),
          favourites: shortcutLabel('navigation.favourites'),
        }}
        canGoBack={navigationStack.back.length > 1}
        canGoForward={navigationStack.forward.length > 0}
        onBack={() => restoreNavigation('back')}
        onForward={() => restoreNavigation('forward')}
        onNavigate={navigate}
        onNewProject={() => setDialog('new-project')}
        onOpenProject={openProjectDialog}
        onSearch={openProjectSearch}
        onOpenPromptBundles={() => handlePromptAction(promptBundles.open())}
        onToggleFavourite={toggleFavourite}
        onAbout={() => setDialog('about')}
        onOpenCollection={openCollection}
        onSelectProject={openProject}
        onDropFiles={(files) =>
          importPaths(Array.from(files).map((file) => window.imnota.getDroppedFilePath(file)))
        }
      >
        {visibleError && (
          <div className="error-banner" role="alert">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>{visibleError}</span>
            <IconButton
              label="Dismiss error"
              onClick={() => {
                setError('');
                persistence.clearError();
                preferences.clearError();
              }}
            >
              <X size={16} aria-hidden="true" />
            </IconButton>
          </div>
        )}
        {persistence.warning && (
          <div className="update-banner" role="status">
            <span>{persistence.warning}</span>
            <IconButton label="Dismiss save warning" onClick={persistence.clearWarning}>
              <X size={16} aria-hidden="true" />
            </IconButton>
          </div>
        )}
        {snapshotNotice && (
          <div className="snapshot-notice" role="status" data-testid="snapshot-notice">
            <div>
              {snapshotNotice.warnings.map((message) => (
                <p key={message}>{message}</p>
              ))}
              {snapshotNotice.recoveredDeletes.map((recovered) => (
                <div className="recovered-delete" key={recovered.undoToken}>
                  <span>A previously deleted screenshot can still be restored.</span>
                  <Button
                    variant="soft"
                    onClick={() => void restoreRecoveredDelete(recovered.undoToken, recovered.screenshotId)}
                  >
                    Undo delete
                  </Button>
                </div>
              ))}
              {snapshotNotice.recoveredContentDeletes.map((recovered) => (
                <div className="recovered-delete" key={recovered.undoToken}>
                  <span>A previously deleted drawing or text block can still be restored.</span>
                  <Button
                    variant="soft"
                    onClick={() =>
                      void undoContent(snapshotNotice.projectPath, recovered.undoToken, recovered.itemId)
                    }
                  >
                    Undo delete
                  </Button>
                </div>
              ))}
            </div>
            <IconButton label="Dismiss project notices" onClick={() => setSnapshotNotice(null)}>
              <X size={16} aria-hidden="true" />
            </IconButton>
          </div>
        )}
        {persistence.externalChange && (
          <div className="external-change-banner" role="alert" data-testid="external-change-banner">
            <span>{persistence.externalChange.message}</span>
            <div>
              <Button
                variant="soft"
                onClick={() => {
                  const discardLocalChanges = persistence.hasUnsavedChanges;
                  if (discardLocalChanges) {
                    if (metadataTimer.current !== null) window.clearTimeout(metadataTimer.current);
                    metadataTimer.current = null;
                  }
                  void contentPersistence.flush().then(async (saved) => {
                    if (!saved) return;
                    contentPersistence.reset();
                    await persistence.reloadExternal({ discardLocalChanges });
                  });
                }}
              >
                {persistence.hasUnsavedChanges ? 'Discard local edits & reload' : 'Reload project'}
              </Button>
              <IconButton label="Dismiss external change notice" onClick={persistence.dismissExternalChange}>
                <X size={16} aria-hidden="true" />
              </IconButton>
            </div>
          </div>
        )}
        {!store.settings.workspacePath ? (
          <Welcome chooseWorkspace={() => void chooseWorkspace()} />
        ) : store.view === 'settings' ? (
          <SettingsView
            preferences={preferences.settings}
            effectiveAppearance={appearance}
            savingPreferences={preferences.saving}
            preferenceError={preferences.error}
            onAppearanceChange={preferences.saveAppearance}
            onShortcutChange={preferences.saveShortcuts}
            onReplayOnboarding={() => setShowOnboarding(true)}
            onDownload={downloadUpdate}
            onInstall={async () => {
              checkpointSession();
              await installUpdate();
            }}
            onWorkspaceChanged={refreshProjects}
          />
        ) : !store.snapshot ? (
          <Library
            onOpenCollection={openCollection}
            onNew={() => setDialog('new-project')}
            onOpen={openProjectDialog}
            onSelect={openProject}
            onEdit={beginProjectEdit}
            onArchive={(path) => void setProjectArchived(path, true)}
            onRestore={(path) => void setProjectArchived(path, false)}
            searchInputRef={projectSearchInputRef}
          />
        ) : (
          <Workspace
            content={contentPersistence.content}
            contentLoading={contentPersistence.loading}
            contentSaveState={contentPersistence.saveState}
            onContentChange={contentPersistence.change}
            onContentRetry={contentPersistence.retry}
            onAddContent={addContent}
            onDuplicateContent={() => mutateContent('duplicate')}
            onDeleteContent={requestContentDeletion}
            onDrawingTitle={(title) => {
              const current = useAppStore.getState().snapshot?.project;
              if (!current) return;
              queueProjectSave({
                ...current,
                contentItems: current.contentItems?.map((item) =>
                  item.id === store.activeScreenshotId && item.kind === 'drawing' ? { ...item, title } : item,
                ),
              });
            }}
            image={persistence.image}
            annotations={persistence.annotations}
            selectedAnnotationId={selectedAnnotationId}
            tool={tool}
            annotationColor={annotationColor}
            paletteColor={paletteColor}
            resolvedTheme={appearance.theme}
            stageRef={stageRef}
            saveState={persistence.saveState}
            canUndo={history.length > 0}
            canRedo={redo.length > 0}
            canUndoDescription={Boolean(activeShot && descriptionHistory[activeShot.id]?.length)}
            shortcutLabels={{
              select: shortcutLabel('tool.select'),
              text: shortcutLabel('tool.text'),
              arrow: shortcutLabel('tool.arrow'),
              rectangle: shortcutLabel('tool.rectangle'),
              highlight: shortcutLabel('tool.highlight'),
              step: shortcutLabel('tool.step'),
              undo: shortcutLabel('edit.undo'),
              redo: shortcutLabel('edit.redo'),
              fit: shortcutLabel('canvas.fit'),
              actualSize: shortcutLabel('canvas.actualSize'),
            }}
            onTool={setTool}
            onColor={(color) => {
              setToolColors((current) => ({
                ...current,
                [selectedAnnotation?.kind ?? creationColorTool]: color,
              }));
              if (selectedAnnotationId)
                changeAnnotations(
                  persistence.annotations.map((item) =>
                    item.id === selectedAnnotationId
                      ? {
                          ...item,
                          stroke: color,
                          ...(['text', 'highlight', 'callout', 'step'].includes(item.kind)
                            ? { fill: color }
                            : {}),
                        }
                      : item,
                  ),
                );
            }}
            onChangeAnnotations={changeAnnotations}
            onSelectAnnotation={setSelectedAnnotationId}
            onUndo={undoAnnotations}
            onRedo={redoAnnotations}
            onFit={() => dispatchCanvasCommand(stageRef.current, 'fit')}
            onActualSize={() => dispatchCanvasCommand(stageRef.current, 'actual-size')}
            onZoom={(delta) => dispatchCanvasCommand(stageRef.current, delta > 0 ? 'zoom-in' : 'zoom-out')}
            onFlush={flushAll}
            onSaveProject={persistence.saveProjectMetadata}
            onUpdateProject={(project) => queueProjectSave(project)}
            onSnapshot={async (snapshot, id) => {
              if (!(await persistence.acceptMutationSnapshot(snapshot, id)))
                throw new Error(
                  'The latest project state could not be adopted. Reload the project and try again.',
                );
            }}
            onSelectScreenshot={selectShot}
            onSelectCollection={selectCollection}
            onImport={() => fileInputRef.current?.click()}
            onPaste={pasteImage}
            onMessage={showToast}
            onUpdateShot={updateShot}
            onDescriptionChange={changeDescription}
            onUndoDescription={undoDescription}
            onDuplicate={duplicateScreenshot}
            onDeleteScreenshot={requestScreenshotDeletion}
            onDeleteProject={() => setDialog('delete-project')}
          />
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const paths = Array.from(event.target.files ?? []).map((file) =>
              window.imnota.getDroppedFilePath(file),
            );
            void importPaths(paths);
            event.target.value = '';
          }}
        />
      </AppShell>
      <FloatingUpdateControl
        status={updateStatus}
        onDownload={downloadUpdate}
        onRetry={() =>
          window.imnota.checkForUpdates().catch(() => setError('Could not check for updates. Try again.'))
        }
        onInstall={async () => {
          try {
            if (await flushAll()) {
              checkpointSession();
              await installUpdate();
            }
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'The update could not be installed.');
          }
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <Check size={16} aria-hidden="true" />
          <span>{toast.message}</span>
          {toast.action && (
            <button type="button" onClick={toast.action.run}>
              {toast.action.label}
            </button>
          )}
        </div>
      )}
      <AppDialogs
        dialog={dialog}
        newProject={newProject}
        editProject={editProject ?? undefined}
        shortcuts={preferences.settings.shortcuts}
        currentVersion={updateStatus?.currentVersion}
        busy={dialogBusy}
        onNewProjectChange={setNewProject}
        onEditProjectChange={setEditProject}
        onSaveProjectEdits={saveProjectEdits}
        onCreateProject={createProject}
        onDeleteProject={deleteProject}
        onShortcutChange={preferences.saveShortcuts}
        onClose={() => setDialog(null)}
      />
      {pendingDeletion && (
        <Modal
          title={pendingDeletion.kind === 'content' ? 'Delete this item?' : 'Delete this screenshot?'}
          description={
            pendingDeletion.kind === 'content'
              ? 'This moves the item to the project trash. You can undo it immediately after deletion.'
              : 'This moves the screenshot to the project trash. You can undo it immediately after deletion.'
          }
          onClose={() => setPendingDeletion(null)}
        >
          <div className="modal-actions">
            <Button data-autofocus variant="ghost" onClick={() => setPendingDeletion(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const target = pendingDeletion;
                setPendingDeletion(null);
                if (!target) return;
                if (target.kind === 'content') void mutateContent('delete', target);
                else void deleteScreenshotNow(target);
              }}
            >
              Move to trash
            </Button>
          </div>
        </Modal>
      )}
      <PromptBundleDialogHost controller={promptBundles} onError={setError} />
      <SearchDialog
        open={searchDialogOpen}
        scope={searchScope}
        onScopeChange={setSearchScope}
        onClose={() => setSearchDialogOpen(false)}
        onOpenResult={openSearchTarget}
      />
      {showOnboarding && (
        <OnboardingDemo
          onCopyBundle={({ markdown, imageDataUrl }) => window.imnota.copyContext({ markdown, imageDataUrl })}
          onMarkCompleted={preferences.saveOnboarding}
          onCreateFirstProject={async () => {
            if (!useAppStore.getState().settings.workspacePath && !(await chooseWorkspace()))
              throw new Error('Workspace selection was cancelled.');
            setShowOnboarding(false);
            setDialog('new-project');
          }}
          onDismiss={() => setShowOnboarding(false)}
        />
      )}
    </>
  );
}

function Welcome({ chooseWorkspace }: { chooseWorkspace(): void }) {
  return (
    <section className="welcome">
      <div className="welcome-mark">
        <Logo compact />
      </div>
      <h1>
        Turn screenshots into
        <br />
        <span>understanding.</span>
      </h1>
      <p>Annotate what matters. Add the context an AI agent needs. Keep every file local and inspectable.</p>
      <div className="welcome-actions">
        <Button variant="primary" onClick={chooseWorkspace}>
          <FolderPlus size={17} aria-hidden="true" />
          Choose workspace
        </Button>
        <span>Works offline. No account required.</span>
      </div>
      <div className="welcome-rule">
        <span>IM</span>
        <i />
        <span>NOTA</span>
      </div>
    </section>
  );
}

export function matchesProjectSearch(project: ProjectListItem, search: string) {
  return (project.searchText ?? `${project.name} ${project.description}`)
    .toLowerCase()
    .includes(search.trim().toLowerCase());
}

function Library({
  onOpenCollection,
  onNew,
  onOpen,
  onSelect,
  onEdit,
  onArchive,
  onRestore,
  searchInputRef,
}: {
  onOpenCollection(projectPath: string, collectionId: string): void | Promise<void>;
  onNew(): void;
  onOpen(): void;
  onSelect(projectPath: string): void;
  onEdit(projectPath: string): void;
  onArchive(projectPath: string): void;
  onRestore(projectPath: string): void;
  searchInputRef: RefObject<HTMLInputElement>;
}) {
  const { projects, search, set, view, settings, recentCollections } = useAppStore();
  const recent = resolveRecentCollections(projects, recentCollections).filter((entry) =>
    `${entry.name} ${entry.projectName}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const filtered = projects.filter((project) => {
    if (view === 'archived') return project.status === 'archived' && matchesProjectSearch(project, search);
    return project.status !== 'archived' && (view !== 'favourites' || project.favourite) && matchesProjectSearch(project, search);
  });
  return (
    <section className="library">
      <div className="library-heading">
        <div>
          <h1>
            {view === 'favourites'
              ? 'Favourite projects'
              : view === 'recent'
                ? 'Recent collections'
                : view === 'archived'
                  ? 'Archived projects'
                : 'Projects'}
          </h1>
          <p>
            {projects.length} local project{projects.length === 1 ? '' : 's'} · {settings.workspacePath}
          </p>
        </div>
        <div className="library-actions">
          <Button variant="ghost" onClick={onOpen}>
            <FolderOpen size={16} aria-hidden="true" />
            Open project
          </Button>
          <Button variant="primary" onClick={onNew}>
            <Plus size={16} aria-hidden="true" />
            New project
          </Button>
        </div>
      </div>
      <div className="search-line">
        <Search size={16} aria-hidden="true" />
        <input
          ref={searchInputRef}
          aria-label="Search projects"
          placeholder={
            view === 'recent'
              ? 'Search recent collections and projects'
              : view === 'archived'
                ? 'Search archived projects'
                : 'Search projects and screenshot descriptions'
          }
          value={search}
          onChange={(event) => set({ search: event.target.value })}
        />
        {search && (
          <button className="search-clear" type="button" onClick={() => set({ search: '' })}>
            Clear search
          </button>
        )}
      </div>
      {view === 'recent' ? (
        recent.length ? (
          <div className="project-list">
            {recent.map((entry) => (
              <button
                className="project-row"
                key={`${entry.projectPath}:${entry.id}`}
                onClick={() => void onOpenCollection(entry.projectPath, entry.id)}
                title={`${entry.projectName} / ${entry.name}`}
              >
                <div className="project-symbol">
                  <Layers3 size={18} aria-hidden="true" />
                </div>
                <div className="project-row-copy">
                  <strong>{entry.name}</strong>
                  <span>{entry.projectName}</span>
                  <small>{relativeOpenedTime(entry.openedAt)}</small>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FolderOpen size={22} aria-hidden="true" />}
            title={search ? 'No matching collections' : 'No recent collections yet'}
            description={
              search
                ? 'Try another collection or project name.'
                : 'Open a project or collection to find it here next time.'
            }
            action={
              !search ? <Button onClick={() => set({ view: 'projects' })}>Browse projects</Button> : undefined
            }
          />
        )
      ) : filtered.length ? (
        <div className="project-list">
          {filtered.map((project) => (
            <div className="project-row" key={project.id}>
              <button className="project-row-main" onClick={() => onSelect(project.projectPath)}>
              <div className="project-symbol">
                <Layers3 size={18} aria-hidden="true" />
              </div>
              <div className="project-row-copy">
                <strong>{project.name}</strong>
                <span>{project.description || 'No description yet'}</span>
                <small>
                  {project.screenshots.length} screenshot{project.screenshots.length === 1 ? '' : 's'} ·
                  edited {new Date(project.updatedAt).toLocaleDateString()}
                </small>
              </div>
              <div className="project-row-meta">
                {project.favourite && <Heart size={15} fill="currentColor" aria-hidden="true" />}
              </div>
              </button>
              <div className="project-row-actions">
                <button type="button" data-testid={`project-edit-${project.id}`} aria-label={`Edit ${project.name}`} onClick={() => onEdit(project.projectPath)}>Edit</button>
                {project.status === 'archived' ? (
                  <button type="button" data-testid={`project-restore-${project.id}`} onClick={() => onRestore(project.projectPath)}>Restore</button>
                ) : (
                  <button type="button" data-testid={`project-archive-${project.id}`} onClick={() => onArchive(project.projectPath)}>Archive</button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FolderOpen size={22} aria-hidden="true" />}
          title={
            search
              ? 'No matching projects'
              : view === 'favourites'
                ? 'No favourite projects yet'
                : view === 'archived'
                  ? 'No archived projects'
                : 'Your project library is empty'
          }
          description={
            search
              ? 'Try another project name or description.'
              : view === 'favourites'
                ? 'Open a project and use the heart button to keep it here.'
                : view === 'archived'
                  ? 'Archived projects stay here until you restore them.'
                : 'Create a local project, then add the screenshots that explain the work.'
          }
          action={
            !search && view !== 'favourites' && view !== 'archived' ? (
              <Button variant="primary" onClick={onNew}>
                <Plus size={16} aria-hidden="true" />
                Create first project
              </Button>
            ) : undefined
          }
        />
      )}
    </section>
  );
}
