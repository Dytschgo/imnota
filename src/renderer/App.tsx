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
import { AppDialogs, type AppDialog, type NewProjectDraft } from './app/AppDialogs';
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
        if (settings.openRecentOnLaunch && projects[0])
          adoptSnapshot(await window.imnota.loadProject(projects[0].projectPath));
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
    const unsubscribe = window.imnota.onUpdateStatus((status) => setUpdateStatus(status));
    void window.imnota
      .getUpdateStatus()
      .then(setUpdateStatus)
      .catch(() => undefined);
    return unsubscribe;
  }, []);

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
    async (action: () => Promise<ProjectSnapshot | null | undefined>, failure: string) => {
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
    if (!(await flushAll())) {
      setError('Navigation was cancelled so your unsaved work stays open.');
      return;
    }
    try {
      const opensLibrary = ['projects', 'recent', 'favourites'].includes(view);
      if (opensLibrary) await refreshProjects();
      if (identity !== navigationIdentity.current) return;
      if (!(await flushAll())) {
        setError('Navigation was cancelled because newer edits could not be saved.');
        return;
      }
      const state = useAppStore.getState();
      const currentIsLibrary = ['projects', 'recent', 'favourites'].includes(state.view) && !state.snapshot;
      state.set({
        view,
        snapshot: opensLibrary || view === 'settings' ? null : state.snapshot,
        search: opensLibrary && !currentIsLibrary ? '' : state.search,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The project library could not be refreshed.');
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
    if (id !== store.activeScreenshotId && (await flushAll()))
      useAppStore.getState().set({ activeScreenshotId: id });
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
    if (navigationIdentityAtStart !== undefined && navigationIdentityAtStart !== navigationIdentity.current)
      return;
    if (id !== store.activeCollectionId && (await flushAll())) {
      if (navigationIdentityAtStart !== undefined && navigationIdentityAtStart !== navigationIdentity.current)
        return;
      useAppStore.getState().setActiveCollection(id);
    }
  }
  async function openCollection(projectPath: string, collectionId: string) {
    if (!(await guardedSnapshot(() => window.imnota.loadProject(projectPath), 'Opening the collection')))
      return;
    const requestIdentity = navigationIdentity.current;
    const current = useAppStore.getState();
    if (current.snapshot?.projectPath === projectPath) await selectCollection(collectionId, requestIdentity);
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
    if (!store.snapshot && ['projects', 'recent', 'favourites'].includes(store.view)) {
      setProjectSearchFocusRequest((value) => value + 1);
      return;
    }
    await navigate('projects');
    if (!useAppStore.getState().snapshot) setProjectSearchFocusRequest((value) => value + 1);
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
        onNavigate={navigate}
        onNewProject={() => setDialog('new-project')}
        onOpenProject={() =>
          void guardedSnapshot(() => window.imnota.openProjectDialog(), 'Opening the project')
        }
        onSearch={openProjectSearch}
        onOpenPromptBundles={() => handlePromptAction(promptBundles.open())}
        onToggleFavourite={toggleFavourite}
        onAbout={() => setDialog('about')}
        onOpenCollection={openCollection}
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
        {updateStatus?.state === 'error' && (
          <div className="update-banner" role="alert">
            <span>{updateStatus.message ?? 'The update check failed.'}</span>
            <Button
              onClick={() =>
                void window.imnota
                  .checkForUpdates()
                  .catch(() => setError('Could not check for updates. Try again.'))
              }
            >
              Retry update check
            </Button>
          </div>
        )}
        {updateStatus?.state === 'available' && (
          <div className="update-banner" role="status">
            <span>{updateStatus.message ?? `Imnota ${updateStatus.version ?? 'update'} is available.`}</span>
            <Button
              onClick={() =>
                void window.imnota
                  .downloadUpdate()
                  .catch(() => setError('The update could not be downloaded.'))
              }
            >
              {updateStatus.terminalCommand
                ? 'Run update in Terminal'
                : updateStatus.manualDownload
                  ? 'Open download'
                  : 'Download update'}
            </Button>
          </div>
        )}
        {updateStatus?.state === 'downloading' && (
          <div className="update-banner" role="status">
            <span>Downloading update… {Math.round(updateStatus.percent ?? 0)}%</span>
            <progress max={100} value={updateStatus.percent ?? 0} aria-label="Update download progress" />
          </div>
        )}
        {updateStatus?.state === 'downloaded' && (
          <div className="update-banner" role="status">
            <span>{updateStatus.message ?? `Imnota ${updateStatus.version ?? 'update'} is ready.`}</span>
            <Button
              variant="soft"
              onClick={async () => {
                if (await flushAll()) {
                  allowClose.current = true;
                  await window.imnota.installUpdate();
                }
              }}
            >
              Restart to update
            </Button>
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
            onInstall={async () => {
              if (await flushAll()) {
                allowClose.current = true;
                await window.imnota.installUpdate();
              }
            }}
            onWorkspaceChanged={refreshProjects}
          />
        ) : !store.snapshot ? (
          <Library
            onNew={() => setDialog('new-project')}
            onOpen={() => guardedSnapshot(() => window.imnota.openProjectDialog(), 'Opening the project')}
            onSelect={(projectPath) =>
              guardedSnapshot(() => window.imnota.loadProject(projectPath), 'Opening the project')
            }
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
        shortcuts={preferences.settings.shortcuts}
        currentVersion={updateStatus?.currentVersion}
        busy={dialogBusy}
        onNewProjectChange={setNewProject}
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
  onNew,
  onOpen,
  onSelect,
  searchInputRef,
}: {
  onNew(): void;
  onOpen(): void;
  onSelect(projectPath: string): void;
  searchInputRef: RefObject<HTMLInputElement>;
}) {
  const { projects, search, set, view, settings } = useAppStore();
  const filtered = projects.filter(
    (project) => (view !== 'favourites' || project.favourite) && matchesProjectSearch(project, search),
  );
  return (
    <section className="library">
      <div className="library-heading">
        <div>
          <h1>{view === 'favourites' ? 'Favourites' : view === 'recent' ? 'Recent projects' : 'Projects'}</h1>
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
          placeholder="Search projects and screenshot descriptions"
          value={search}
          onChange={(event) => set({ search: event.target.value })}
        />
        {search && (
          <button className="search-clear" type="button" onClick={() => set({ search: '' })}>
            Clear search
          </button>
        )}
      </div>
      {filtered.length ? (
        <div className="project-list">
          {filtered.map((project) => (
            <button className="project-row" key={project.id} onClick={() => onSelect(project.projectPath)}>
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
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FolderOpen size={22} aria-hidden="true" />}
          title={search ? 'No matching projects' : 'Your project library is empty'}
          description={
            search
              ? 'Try another project name or description.'
              : 'Create a local project, then add the screenshots that explain the work.'
          }
          action={
            !search ? (
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
