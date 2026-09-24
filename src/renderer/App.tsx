import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type Konva from 'konva';
import {
  Archive,
  ArchiveRestore,
  CircleAlert,
  Check,
  FolderOpen,
  FolderPlus,
  Heart,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
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
import type { ContentSearchResult } from '../shared/content-search';
import type { CaptureDelaySeconds, CaptureDisplayOption } from '../shared/capture';
import { nowIso } from '../shared/utils';
import { orderedCollectionItems } from '../shared/content-items';
import { useContentPersistence } from './content/useContentPersistence';
import { collectionDisplayName } from './collection/collection-display-name';
import { AppDialogs, type AppDialog, type NewProjectDraft, type ProjectEditDraft } from './app/AppDialogs';
import { AppShell } from './app/AppShell';
import { useAppearance } from './app/useAppearance';
import { usePreferences } from './app/usePreferences';
import { useProjectPersistence } from './app/useProjectPersistence';
import { Workspace } from './app/Workspace';
import { liveTextColor, semanticAnnotationColor } from './canvas/annotation-layout';
import { dispatchCanvasCommand } from './canvas/commands';
import { Logo } from './components/Logo';
import { ProjectIcon } from './components/ProjectIcon';
import type { ToolChoice } from './components/Toolbar';
import { Button, EmptyState, IconButton, Modal } from './components/ui';
import { OnboardingDemo } from './onboarding';
import { PromptBundleDialogHost } from './export/PromptBundleDialogHost';
import { usePromptBundleController } from './export/usePromptBundleController';
import { SETTINGS_CATEGORIES, SettingsView, useKeyboardShortcuts, type SettingsCategory } from './settings';
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
import './app/project-management.css';
import { ContentSearchResults } from './search/ContentSearchResults';
import { WorkflowRequestError, workflowValue } from './app/workflow';
import { CaptureDisplayDialog } from './capture/CaptureDisplayDialog';
import { CaptureDestinationDialog } from './capture/CaptureDestinationDialog';
import {
  captureDestinationChoices,
  currentCaptureDestination,
  lastUsedCurrentDestination,
  type CaptureDestination,
  type CaptureDestinationChoice,
} from './capture/capture-destination';
import { WhatsNewDialog, type WhatsNewAction } from './components/WhatsNew';
import { findWhatsNewRelease, shouldShowWhatsNew } from '../shared/whats-new';

export { CollectionControls } from './collection/CollectionRail';
export { SettingsView } from './settings/SettingsView';

interface SnapshotNotice {
  projectPath: string;
  warnings: string[];
}

interface SnapshotExtras {
  warnings?: string[];
}

type PendingDeletion = {
  kind: 'content' | 'screenshot';
  projectPath: string;
  itemId: string;
  title: string;
};

type ToastNotification = {
  message: string;
  action?: { label: string; run(): void };
};

export function userFacingErrorMessage(message: string): string {
  const withoutIpcWrapper = message.replace(/^Error invoking remote method '[^']+':\s*/i, '');
  return withoutIpcWrapper.replace(/^(?:Error(?:[.:]\s*|\s+))+/i, '') || 'Something went wrong. Try again.';
}

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
  const [projectToDelete, setProjectToDelete] = useState<ProjectListItem | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
  const [tool, setTool] = useState<ToolChoice>('select');
  const lastAnnotateTool = useRef<ToolChoice>('arrow');
  const pendingOverlayAction = useRef<'save' | 'annotate'>('save');
  const [toolColors, setToolColors] = useState<Partial<Record<ToolChoice, string>>>({});
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [history, setHistory] = useState<Annotation[][]>([]);
  const [redo, setRedo] = useState<Annotation[][]>([]);
  const [descriptionHistory, setDescriptionHistory] = useState<Record<string, string[]>>({});
  const [error, setError] = useState('');
  const [toast, setToast] = useState<ToastNotification | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [snapshotNotice, setSnapshotNotice] = useState<SnapshotNotice | null>(null);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [searchScope, setSearchScope] = useState<ProjectSearchScope>('active');
  const [pendingSearchAnnotationId, setPendingSearchAnnotationId] = useState<string | null>(null);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('Appearance');
  const [navigationStack, setNavigationStack] = useState({
    back: [] as NavigationLocation[],
    forward: [] as NavigationLocation[],
  });
  const [projectSessionGeneration, setProjectSessionGeneration] = useState(0);
  const stageRef = useRef<Konva.Stage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const metadataTimer = useRef<number | null>(null);
  const allowClose = useRef(false);
  const copiedAnnotation = useRef<Annotation | null>(null);
  const dismissedWhatsNewVersion = useRef<string | null>(null);
  const navigationIdentity = useRef(0);
  const [searchTarget, setSearchTarget] = useState<{
    result: ContentSearchResult;
    identity: number;
    query: string;
  } | null>(null);
  const captureBusyRef = useRef(false);
  const [capturing, setCapturing] = useState(false);
  const captureDisplayResolver = useRef<((displayId: number | null) => void) | null>(null);
  const captureDestinationResolver = useRef<((destination: CaptureDestination | null) => void) | null>(null);
  const [captureDisplayChoices, setCaptureDisplayChoices] = useState<readonly CaptureDisplayOption[] | null>(
    null,
  );
  const [captureDestinationOptions, setCaptureDestinationOptions] = useState<
    readonly CaptureDestinationChoice[] | null
  >(null);
  useEffect(
    () => () => {
      captureDisplayResolver.current?.(null);
      captureDisplayResolver.current = null;
      captureDestinationResolver.current?.(null);
      captureDestinationResolver.current = null;
    },
    [],
  );

  const activeShot = store.activeScreenshot();
  const adoptSnapshot = useCallback((snapshot: ProjectSnapshot, selectScreenshotId?: string) => {
    useAppStore.getState().setProject(snapshot, selectScreenshotId);
    const extras = snapshot as ProjectSnapshot & SnapshotExtras;
    setSnapshotNotice((current) => {
      const sameProject = current?.projectPath === snapshot.projectPath;
      const warnings = [...new Set([...(sameProject ? current.warnings : []), ...(extras.warnings ?? [])])];
      return warnings.length ? { projectPath: snapshot.projectPath, warnings } : null;
    });
    setError('');
  }, []);
  const persistence = useProjectPersistence({
    snapshot: store.snapshot,
    activeScreenshot: activeShot,
    sessionGeneration: projectSessionGeneration,
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
  useEffect(() => {
    if (!searchTarget) return;
    const { result, identity, query } = searchTarget;
    if (
      navigationIdentity.current !== identity ||
      store.view !== 'workspace' ||
      store.snapshot?.projectPath !== result.projectPath ||
      store.snapshot.project.id !== result.projectId ||
      (result.itemId && store.activeScreenshotId !== result.itemId)
    )
      return;
    if (result.kind === 'text' && contentPersistence.content?.item.id !== result.itemId) return;
    const frame = window.requestAnimationFrame(() => {
      if (identity !== navigationIdentity.current) return;
      const current = useAppStore.getState();
      if (
        current.view !== 'workspace' ||
        current.snapshot?.projectPath !== result.projectPath ||
        (result.itemId && current.activeScreenshotId !== result.itemId)
      )
        return;
      const editor =
        result.kind === 'text'
          ? document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown"]')
          : null;
      const target =
        editor ??
        document.querySelector<HTMLButtonElement>(
          result.itemId ? '.shot-item.active .shot-select' : '[data-testid="collection-picker"]',
        );
      target?.focus();
      if (editor) {
        const term = query
          .trim()
          .toLocaleLowerCase()
          .split(/\s+/)
          .find((part) => editor.value.toLocaleLowerCase().includes(part));
        if (term) {
          const start = editor.value.toLocaleLowerCase().indexOf(term);
          editor.setSelectionRange(start, start + term.length);
        }
      }
      if (target) setSearchTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchTarget, store.view, store.snapshot, store.activeScreenshotId, contentPersistence.content]);
  const getSavedPromptContext = useCallback(async () => {
    if (!(await contentPersistence.flush()))
      throw new Error('Save the current drawing or text before preparing the prompt.');
    return persistence.getSavedContext(useAppStore.getState().activeCollectionId);
  }, [persistence, contentPersistence]);
  const promptBundles = usePromptBundleController({
    getSavedContext: getSavedPromptContext,
    getIncludeRecognisedText: () => preferences.settings.promptExport.includeRecognisedText,
  });
  const handlePromptAction = useCallback(
    async (action: ReturnType<typeof promptBundles.open>) => {
      const result = await action;
      if (!result.ok) setError(result.error.message);
    },
    [promptBundles],
  );

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );
  const showToast = useCallback((message: string, action?: ToastNotification['action']) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast({ message, action });
    if (action) {
      toastTimer.current = null;
      return;
    }
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 3500);
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

  const whatsNewRelease = findWhatsNewRelease(updateStatus?.currentVersion);
  const onboardingPending =
    preferences.result &&
    shouldShowOnboarding(preferences.result.settings.onboarding, preferences.result.profile);
  useEffect(() => {
    if (
      dialog ||
      snapshotNotice ||
      searchDialogOpen ||
      onboardingPending ||
      showOnboarding ||
      !preferences.result ||
      !whatsNewRelease
    )
      return;
    if (
      shouldShowWhatsNew(
        updateStatus?.currentVersion,
        preferences.result.settings.updates.whatsNewAcknowledgedVersion,
        whatsNewRelease,
      ) &&
      dismissedWhatsNewVersion.current !== updateStatus?.currentVersion
    )
      setShowWhatsNew(true);
  }, [
    dialog,
    onboardingPending,
    preferences.result,
    searchDialogOpen,
    showOnboarding,
    snapshotNotice,
    updateStatus?.currentVersion,
    whatsNewRelease,
  ]);

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
      settingsCategory: current.view === 'settings' ? settingsCategory : undefined,
      scrollTop: document.querySelector<HTMLElement>('.library, [data-testid="settings-view"], .workspace')
        ?.scrollTop,
    };
  }, [settingsCategory]);

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
  const prepareBackupAction = useCallback(async (): Promise<boolean> => {
    if (metadataTimer.current !== null) {
      window.clearTimeout(metadataTimer.current);
      metadataTimer.current = null;
    }
    if (!(await contentPersistence.flush())) return false;
    if (!(await persistence.flushProjectDrafts())) return false;
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

  function clearSearchSelection() {
    setSelectedAnnotationId(null);
    setPendingSearchAnnotationId(null);
  }

  const guardedSnapshot = useCallback(
    async (action: () => Promise<ProjectSnapshot | null | undefined>, failure: string, recordOpen = true) => {
      if (captureBusyRef.current) {
        setError('Finish or cancel the screen capture before changing projects.');
        return false;
      }
      const identity = ++navigationIdentity.current;
      if (!(await flushAll())) {
        if (identity === navigationIdentity.current)
          setError(`${failure} was cancelled so your unsaved work stays open.`);
        return false;
      }
      if (identity !== navigationIdentity.current) return false;
      const nativeMutationToken = persistence.beginNativeMutation();
      try {
        const next = await action();
        if (identity !== navigationIdentity.current) {
          await persistence.cancelNativeMutation(nativeMutationToken);
          return false;
        }
        if (next) {
          if (
            !(await persistence.adoptAuthoritativeSnapshot(
              next,
              nativeMutationToken,
              () => identity === navigationIdentity.current,
            ))
          ) {
            if (identity === navigationIdentity.current)
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
    if (captureBusyRef.current) {
      setError('Finish or cancel the screen capture before navigating.');
      return;
    }
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
      if (identity !== navigationIdentity.current) return;
      const state = useAppStore.getState();
      const currentIsLibrary =
        ['projects', 'recent', 'favourites', 'archived'].includes(state.view) && !state.snapshot;
      clearSearchSelection();
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
    const startingStack = replaceNavigationLocation(navigationStack, currentLocation());
    const startingLocation = startingStack.back.at(-1)!;
    let candidateStack = startingStack;
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
          const nativeMutationToken = persistence.beginNativeMutation();
          let adopted = false;
          let snapshot: ProjectSnapshot;
          try {
            snapshot = await window.imnota.loadProject(target.projectPath);
          } catch (reason) {
            await persistence.cancelNativeMutation(nativeMutationToken);
            if (isMissingNavigationTargetError(reason)) {
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
          if (snapshot.project.status === 'archived') {
            await persistence.cancelNativeMutation(nativeMutationToken);
            candidateStack = moved.stack;
            moved = moveNavigationLocation(candidateStack, direction);
            continue;
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
          if (
            target.view === 'settings' &&
            SETTINGS_CATEGORIES.includes(target.settingsCategory as SettingsCategory)
          )
            setSettingsCategory(target.settingsCategory as SettingsCategory);
        }
        clearSearchSelection();
        setNavigationStack(
          direction === 'back'
            ? { back: moved.stack.back, forward: [startingLocation, ...startingStack.forward] }
            : { back: [...startingStack.back, target], forward: moved.stack.forward },
        );
        if (target.scrollTop !== undefined)
          window.requestAnimationFrame(() => {
            const container = document.querySelector<HTMLElement>(
              '.library, [data-testid="settings-view"], .workspace',
            );
            if (container) container.scrollTop = target.scrollTop!;
          });
        return;
      }
      setNavigationStack(
        direction === 'back'
          ? { back: [startingLocation], forward: startingStack.forward }
          : { back: startingStack.back, forward: [] },
      );
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
    const identity = ++navigationIdentity.current;
    const previousLocation = currentLocation();
    if (!(await flushAll())) {
      if (identity === navigationIdentity.current)
        setError('Project creation was cancelled so your unsaved work stays open.');
      return;
    }
    if (identity !== navigationIdentity.current) return;
    setDialogBusy(true);
    try {
      if (!store.settings.workspacePath && !(await chooseWorkspace())) return;
      if (identity !== navigationIdentity.current) return;
      const snapshot = await window.imnota.createProject(newProject);
      if (identity !== navigationIdentity.current) return;
      if (!(await flushAll())) {
        if (identity === navigationIdentity.current)
          setError(
            'The project was created, but the current project stayed open because newer edits could not be saved.',
          );
        return;
      }
      if (identity !== navigationIdentity.current) return;
      await refreshProjects();
      if (identity !== navigationIdentity.current) return;
      setDialog(null);
      setNewProject({ name: '', description: '' });
      clearSearchSelection();
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
    const identity = navigationIdentity.current;
    const projectPath = current.snapshot.projectPath;
    const collectionId = current.activeCollectionId;
    const isCurrentProject = () =>
      identity === navigationIdentity.current && useAppStore.getState().snapshot?.projectPath === projectPath;
    const existingIds = new Set(current.snapshot.project.screenshots.map((shot) => shot.id));
    const nativeMutationToken = await beginCurrentProjectMutation();
    if (nativeMutationToken === null) return;
    if (!isCurrentProject()) {
      await persistence.cancelNativeMutation(nativeMutationToken);
      return;
    }
    try {
      const snapshot = await window.imnota.importImageFiles({
        projectPath,
        collectionId,
        paths,
      });
      const newest = snapshot.project.screenshots
        .filter((shot) => shot.collectionId === collectionId && !existingIds.has(shot.id))
        .sort((left, right) => left.position - right.position)
        .at(-1);
      if (!(await persistence.acceptMutationSnapshot(snapshot, newest?.id, nativeMutationToken))) return;
      await refreshProjects();
      showToast(`${paths.length} screenshot${paths.length === 1 ? '' : 's'} added`);
    } catch (reason) {
      const importError = reason instanceof Error ? reason.message : 'The screenshots could not be imported.';
      let partialImport = false;
      if (isCurrentProject()) {
        try {
          const reloaded = await window.imnota.loadProject(projectPath);
          if (
            isCurrentProject() &&
            reloaded.projectPath === projectPath &&
            reloaded.project.screenshots.some((shot) => !existingIds.has(shot.id))
          ) {
            partialImport = await persistence.adoptAuthoritativeSnapshot(
              reloaded,
              nativeMutationToken,
              isCurrentProject,
            );
            if (partialImport && isCurrentProject()) await refreshProjects();
          }
        } catch {
          // The native import error is still the actionable failure if recovery cannot reload.
        }
      }
      await persistence.cancelNativeMutation(nativeMutationToken);
      if (isCurrentProject())
        setError(
          partialImport
            ? `${importError} Some screenshots were added before the import stopped.`
            : importError,
        );
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
  function settleCaptureDisplayChoice(displayId: number | null) {
    const resolve = captureDisplayResolver.current;
    captureDisplayResolver.current = null;
    setCaptureDisplayChoices(null);
    resolve?.(displayId);
  }
  function settleCaptureDestinationChoice(destination: CaptureDestination | null) {
    const resolve = captureDestinationResolver.current;
    captureDestinationResolver.current = null;
    setCaptureDestinationOptions(null);
    resolve?.(destination);
  }
  async function chooseCaptureDisplay(): Promise<number | null | undefined> {
    if (detectShortcutPlatform() !== 'windows') return undefined;
    const displays = workflowValue(await window.imnota.listCaptureDisplays());
    if (displays.length === 0) throw new Error('Windows did not report an available display to capture.');
    if (displays.length === 1) return displays[0]!.id;
    workflowValue(await window.imnota.raiseMainWindow());
    return new Promise<number | null>((resolve) => {
      captureDisplayResolver.current = resolve;
      setCaptureDisplayChoices(displays);
    });
  }
  async function chooseCaptureDestination(
    choices: readonly CaptureDestinationChoice[],
  ): Promise<CaptureDestination | null> {
    workflowValue(await window.imnota.raiseMainWindow());
    return new Promise((resolve) => {
      captureDestinationResolver.current = resolve;
      setCaptureDestinationOptions(choices);
    });
  }
  async function adoptCaptureDestination(destination: CaptureDestination): Promise<boolean> {
    const current = useAppStore.getState();
    if (current.snapshot?.projectPath !== destination.projectPath) {
      try {
        adoptSnapshot(await window.imnota.loadProject(destination.projectPath));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'The collection could not be opened.');
        return false;
      }
    }
    const snapshot = useAppStore.getState().snapshot;
    const collection = snapshot?.project.collections.find((item) => item.id === destination.collectionId);
    if (!snapshot || snapshot.projectPath !== destination.projectPath || !collection) {
      setError('Choose a collection before capturing.');
      return false;
    }
    if (useAppStore.getState().activeCollectionId !== destination.collectionId)
      useAppStore.getState().setActiveCollection(destination.collectionId);
    return true;
  }
  async function finishCapturedScreenshot(
    snapshot: ProjectSnapshot,
    screenshotId: string,
    nativeMutationToken: number,
    overlayAction: 'save' | 'annotate' = 'save',
  ): Promise<boolean> {
    const accepted = await persistence.acceptMutationSnapshot(snapshot, screenshotId, nativeMutationToken);
    if (!accepted) return false;
    await refreshProjects();
    useAppStore.getState().set({ activeScreenshotId: screenshotId });
    showToast(overlayAction === 'annotate' ? 'Screen capture added — annotate' : 'Screen capture added');
    if (overlayAction === 'annotate') setTool(lastAnnotateTool.current);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>('.annotation-canvas')?.focus());
    return true;
  }
  async function settleBufferedCapture(): Promise<void> {
    const state = useAppStore.getState();
    let destination = lastUsedCurrentDestination(state.projects, state.recentCollections);
    if (!destination) {
      const choices = captureDestinationChoices(state.projects, state.recentCollections, state.snapshot);
      if (choices.length === 0) {
        setError(
          state.snapshot
            ? 'Choose a current collection before capturing.'
            : 'Open a project and choose a current collection before capturing.',
        );
        await window.imnota.discardBufferedCapture();
        return;
      }
      destination = await chooseCaptureDestination(choices);
      if (!destination) {
        await window.imnota.discardBufferedCapture();
        return;
      }
    }
    if (!(await adoptCaptureDestination(destination))) {
      await window.imnota.discardBufferedCapture();
      return;
    }
    const nativeMutationToken = persistence.beginNativeMutation();
    try {
      const committed = workflowValue(await window.imnota.commitBufferedCapture(destination));
      await finishCapturedScreenshot(
        committed.snapshot,
        committed.screenshotId,
        nativeMutationToken,
        pendingOverlayAction.current,
      );
    } catch (reason) {
      await persistence.cancelNativeMutation(nativeMutationToken);
      throw reason;
    }
  }
  async function captureRegion(
    delaySeconds?: CaptureDelaySeconds,
    repeatLast = false,
    overlayMode: 'region' | 'window' | 'display' = 'region',
  ) {
    if (captureBusyRef.current) return;
    captureBusyRef.current = true;
    setCapturing(true);
    let nativeMutationToken: number | null = null;
    try {
      if (detectShortcutPlatform() === 'linux') {
        setError('Screen capture is unavailable on Linux — use Import or Paste');
        return;
      }
      if (!preferences.settings.capture.experimentalRegionCapture) {
        setError('Screen capture is off — enable it in Settings → Features');
        return;
      }
      const current = useAppStore.getState();
      const destination = currentCaptureDestination(current.snapshot, current.activeCollectionId);
      if (repeatLast) {
        if (!destination || !current.snapshot) {
          setError('Open a project and choose a current collection before repeating a capture.');
          return;
        }
        const target = {
          projectPath: destination.projectPath,
          projectId: current.snapshot.project.id,
          collectionId: destination.collectionId,
          navigationIdentity: navigationIdentity.current,
        };
        nativeMutationToken = await beginCurrentProjectMutation();
        if (nativeMutationToken === null) return;
        const afterFlush = useAppStore.getState();
        const afterSnapshot = afterFlush.snapshot;
        const activeCollection = afterSnapshot?.project.collections.find(
          (item) => item.id === target.collectionId,
        );
        if (
          navigationIdentity.current !== target.navigationIdentity ||
          !afterSnapshot ||
          afterSnapshot.projectPath !== target.projectPath ||
          afterSnapshot.project.id !== target.projectId ||
          afterFlush.activeCollectionId !== target.collectionId ||
          !activeCollection
        ) {
          await persistence.cancelNativeMutation(nativeMutationToken);
          nativeMutationToken = null;
          return;
        }
        const result = workflowValue(
          await window.imnota.repeatLastRegionCapture({
            projectPath: target.projectPath,
            collectionId: target.collectionId,
          }),
        );
        const accepted = await finishCapturedScreenshot(
          result.snapshot,
          result.screenshotId,
          nativeMutationToken,
        );
        nativeMutationToken = null;
        if (!accepted) return;
        return;
      }
      const displayId = await chooseCaptureDisplay();
      if (displayId === null) return;
      if (destination && current.snapshot) {
        const target = {
          projectPath: destination.projectPath,
          projectId: current.snapshot.project.id,
          collectionId: destination.collectionId,
          navigationIdentity: navigationIdentity.current,
        };
        const afterChoice = useAppStore.getState();
        const chosenSnapshot = afterChoice.snapshot;
        const chosenCollection = chosenSnapshot?.project.collections.find(
          (item) => item.id === target.collectionId,
        );
        if (
          navigationIdentity.current !== target.navigationIdentity ||
          !chosenSnapshot ||
          chosenSnapshot.projectPath !== target.projectPath ||
          chosenSnapshot.project.id !== target.projectId ||
          afterChoice.activeCollectionId !== target.collectionId ||
          !chosenCollection
        )
          return;
        nativeMutationToken = await beginCurrentProjectMutation();
        if (nativeMutationToken === null) return;
        const afterFlush = useAppStore.getState();
        const afterSnapshot = afterFlush.snapshot;
        const activeCollection = afterSnapshot?.project.collections.find(
          (item) => item.id === target.collectionId,
        );
        if (
          navigationIdentity.current !== target.navigationIdentity ||
          !afterSnapshot ||
          afterSnapshot.projectPath !== target.projectPath ||
          afterSnapshot.project.id !== target.projectId ||
          afterFlush.activeCollectionId !== target.collectionId ||
          !activeCollection
        ) {
          await persistence.cancelNativeMutation(nativeMutationToken);
          nativeMutationToken = null;
          return;
        }
        const result = workflowValue(
          await window.imnota.startRegionCapture({
            projectPath: target.projectPath,
            collectionId: target.collectionId,
            displayId,
            overlayMode,
            ...(delaySeconds ? { delaySeconds } : {}),
          }),
        );
        if ('buffered' in result) {
          pendingOverlayAction.current = result.overlayAction;
          await persistence.cancelNativeMutation(nativeMutationToken);
          nativeMutationToken = null;
          await settleBufferedCapture();
          return;
        }
        const accepted = await finishCapturedScreenshot(
          result.snapshot,
          result.screenshotId,
          nativeMutationToken,
          result.overlayAction,
        );
        nativeMutationToken = null;
        if (!accepted) return;
        return;
      }
      const result = workflowValue(
        await window.imnota.startRegionCapture({
          displayId,
          overlayMode,
          ...(delaySeconds ? { delaySeconds } : {}),
        }),
      );
      if (!('buffered' in result)) return;
      pendingOverlayAction.current = result.overlayAction;
      await settleBufferedCapture();
    } catch (reason) {
      if (nativeMutationToken !== null) {
        await persistence.cancelNativeMutation(nativeMutationToken);
        nativeMutationToken = null;
      }
      if (reason instanceof WorkflowRequestError && reason.workflowError.code === 'capture-cancelled') return;
      setError(reason instanceof Error ? reason.message : 'The screen capture could not be completed.');
    } finally {
      captureBusyRef.current = false;
      setCapturing(false);
    }
  }
  async function selectShot(id: string) {
    const identity = ++navigationIdentity.current;
    const previousLocation = currentLocation();
    if (id !== store.activeScreenshotId && (await flushAll())) {
      if (identity !== navigationIdentity.current) return;
      clearSearchSelection();
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
        showToast(`${item.kind === 'drawing' ? 'Drawing' : 'Text block'} moved to trash.`, {
          label: 'Undo',
          run: () => {
            void undoContent(input.projectPath, result.undoToken, item.id);
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
  async function requestContentDeletion(requestedId?: string) {
    const identity = ++navigationIdentity.current;
    const before = useAppStore.getState();
    if (!(await flushAll())) return;
    const current = useAppStore.getState();
    if (
      identity !== navigationIdentity.current ||
      current.snapshot?.projectPath !== before.snapshot?.projectPath
    )
      return;
    const targetId =
      !requestedId || requestedId === before.activeScreenshotId ? current.activeScreenshotId : requestedId;
    const item = current.snapshot?.project.contentItems?.find((entry) => entry.id === targetId);
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
    } catch (reason) {
      await persistence.cancelNativeMutation(token);
      setError(reason instanceof Error ? reason.message : 'The item could not be restored.');
    }
  }
  async function selectCollection(id: string, navigationIdentityAtStart?: number) {
    if (captureBusyRef.current) {
      setError('Finish or cancel the screen capture before changing collections.');
      return;
    }
    const identity = navigationIdentityAtStart ?? ++navigationIdentity.current;
    if (identity !== navigationIdentity.current) return;
    clearSearchSelection();
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
    clearSearchSelection();
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
    clearSearchSelection();
    if (!(await guardedSnapshot(() => window.imnota.loadProject(projectPath), 'Opening the project'))) return;
    setNavigationStack((stack) =>
      pushNavigationLocation(replaceNavigationLocation(stack, previousLocation), currentLocation()),
    );
  }
  async function openProjectDialog() {
    const previousLocation = currentLocation();
    clearSearchSelection();
    if (!(await guardedSnapshot(() => window.imnota.openProjectDialog(), 'Opening the project'))) return;
    setNavigationStack((stack) =>
      pushNavigationLocation(replaceNavigationLocation(stack, previousLocation), currentLocation()),
    );
  }
  async function openContentSearchResult(result: ContentSearchResult) {
    const opening = guardedSnapshot(async () => {
      const next = await window.imnota.loadProject(result.projectPath);
      const target = [
        ...next.project.screenshots.map((item) => ({ ...item, kind: 'screenshot' })),
        ...(next.project.contentItems ?? []),
      ].find(
        (item) =>
          item.id === result.itemId && item.collectionId === result.collectionId && item.kind === result.kind,
      );
      if (
        next.projectPath !== result.projectPath ||
        next.project.id !== result.projectId ||
        (result.collectionId &&
          !next.project.collections.some((collection) => collection.id === result.collectionId)) ||
        (result.itemId && !target)
      )
        throw new Error(
          'This search result changed or is no longer available. Refresh search and try again.',
        );
      return next;
    }, 'Opening the search result');
    const identity = navigationIdentity.current;
    if (!(await opening) || identity !== navigationIdentity.current) return;
    const state = useAppStore.getState();
    if (state.snapshot?.projectPath !== result.projectPath || state.snapshot.project.id !== result.projectId)
      return;
    if (
      (result.collectionId &&
        !state.snapshot.project.collections.some((collection) => collection.id === result.collectionId)) ||
      (result.itemId &&
        ![...state.snapshot.project.screenshots, ...(state.snapshot.project.contentItems ?? [])].some(
          (item) => item.id === result.itemId && item.collectionId === result.collectionId,
        ))
    ) {
      setError('This search result is no longer available. Refresh search and try again.');
      return;
    }
    if (result.collectionId) state.setActiveCollection(result.collectionId);
    if (result.itemId) state.set({ activeScreenshotId: result.itemId });
    state.set({ leftPanelOpen: true });
    setSearchTarget({ result, identity, query: state.search });
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
  async function requestScreenshotDeletion(requestedId?: string) {
    const identity = ++navigationIdentity.current;
    const before = useAppStore.getState();
    if (!(await flushAll())) return;
    const current = useAppStore.getState();
    if (
      identity !== navigationIdentity.current ||
      current.snapshot?.projectPath !== before.snapshot?.projectPath
    )
      return;
    const targetId =
      !requestedId || requestedId === before.activeScreenshotId ? current.activeScreenshotId : requestedId;
    const shot = current.snapshot?.project.screenshots.find((entry) => entry.id === targetId);
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
      showToast('Screenshot moved to trash.', {
        label: 'Undo',
        run: () => void undoDeletedScreenshot(current.snapshot!.projectPath, result.undoToken, shot.id),
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
  function requestProjectDeletion(projectPath: string) {
    const project = useAppStore.getState().projects.find((entry) => entry.projectPath === projectPath);
    if (!project) return;
    setProjectToDelete(project);
    setDialog('delete-project');
  }
  async function deleteProject() {
    const target = projectToDelete;
    if (!target) return;
    const identity = ++navigationIdentity.current;
    if (!(await flushAll()) || identity !== navigationIdentity.current) return;
    setDialogBusy(true);
    try {
      await window.imnota.deleteProject(target.projectPath);
      setDialog((current) => (current === 'delete-project' ? null : current));
      setProjectToDelete(null);
      if (
        identity === navigationIdentity.current &&
        useAppStore.getState().snapshot?.projectPath === target.projectPath
      )
        useAppStore.getState().setProject(null);
      await refreshProjects();
      if (identity !== navigationIdentity.current) return;
      showToast('Project moved to the system trash');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The project could not be deleted.');
    } finally {
      setDialogBusy(false);
    }
  }
  async function beginProjectEdit(projectPath: string) {
    const identity = ++navigationIdentity.current;
    if (!(await flushAll())) {
      if (identity === navigationIdentity.current)
        setError('Editing the project was cancelled so your unsaved work stays open.');
      return;
    }
    if (identity !== navigationIdentity.current) return;
    try {
      const snapshot = await window.imnota.loadProject(projectPath);
      if (identity !== navigationIdentity.current) return;
      if (!snapshot.projectRevision) {
        setError('Project metadata cannot be edited until its revision is available.');
        return;
      }
      setEditProjectPath(projectPath);
      setEditProjectRevision(snapshot.projectRevision);
      setEditProject({
        name: snapshot.project.name,
        description: snapshot.project.description,
        icon: snapshot.project.icon ?? 'layers',
      });
      setDialog('edit-project');
    } catch (reason) {
      if (identity === navigationIdentity.current)
        setError(reason instanceof Error ? reason.message : 'Project details could not be loaded.');
    }
  }
  async function saveProjectEdits() {
    if (!editProject || !editProjectPath || !editProjectRevision) return;
    const draft = editProject;
    const projectPath = editProjectPath;
    const expectedRevision = editProjectRevision;
    const identity = ++navigationIdentity.current;
    setDialogBusy(true);
    let nativeMutationToken: number | null = null;
    try {
      if (!(await flushAll())) {
        if (identity === navigationIdentity.current)
          setError('Saving project details was cancelled so your unsaved work stays open.');
        return;
      }
      if (identity !== navigationIdentity.current) return;
      nativeMutationToken = persistence.beginNativeMutation();
      const result = await window.imnota.updateProjectMetadata({
        projectPath,
        expectedRevision,
        patch: draft,
      });
      if (identity !== navigationIdentity.current) {
        await persistence.cancelNativeMutation(nativeMutationToken);
        nativeMutationToken = null;
        return;
      }
      if (useAppStore.getState().snapshot?.projectPath === projectPath) {
        const adopted = await persistence.adoptAuthoritativeSnapshot(result, nativeMutationToken);
        nativeMutationToken = null;
        if (!adopted || identity !== navigationIdentity.current) return;
      } else {
        await persistence.cancelNativeMutation(nativeMutationToken);
        nativeMutationToken = null;
        if (identity !== navigationIdentity.current) return;
      }
      await refreshProjects();
      if (identity !== navigationIdentity.current) return;
      setDialog(null);
      setEditProject(null);
      setEditProjectPath(null);
      setEditProjectRevision(null);
      showToast('Project details saved');
    } catch (reason) {
      if (nativeMutationToken !== null) await persistence.cancelNativeMutation(nativeMutationToken);
      if (identity === navigationIdentity.current)
        setError(reason instanceof Error ? reason.message : 'Project details could not be saved.');
    } finally {
      setDialogBusy(false);
    }
  }
  async function setProjectArchived(projectPath: string, archived: boolean, expectedRevision?: string) {
    const identity = ++navigationIdentity.current;
    if (!(await flushAll())) {
      if (identity === navigationIdentity.current)
        setError('The project archive change was cancelled so your unsaved work stays open.');
      return;
    }
    if (identity !== navigationIdentity.current) return;
    let nativeMutationToken: number | null = persistence.beginNativeMutation();
    try {
      const loaded = expectedRevision ? null : await window.imnota.loadProject(projectPath);
      if (identity !== navigationIdentity.current) {
        await persistence.cancelNativeMutation(nativeMutationToken);
        nativeMutationToken = null;
        return;
      }
      const revision = expectedRevision ?? loaded?.projectRevision;
      if (!revision) throw new Error('Project revision is unavailable.');
      const result = await window.imnota.setProjectArchived({
        projectPath,
        expectedRevision: revision,
        archived,
      });
      if (identity !== navigationIdentity.current) {
        await persistence.cancelNativeMutation(nativeMutationToken);
        nativeMutationToken = null;
        return;
      }
      if (useAppStore.getState().snapshot?.projectPath === projectPath) {
        const adopted = await persistence.adoptAuthoritativeSnapshot(result, nativeMutationToken);
        nativeMutationToken = null;
        if (!adopted || identity !== navigationIdentity.current) return;
        if (useAppStore.getState().snapshot?.projectPath !== projectPath) return;
        useAppStore.getState().setProject(null);
      } else {
        await persistence.cancelNativeMutation(nativeMutationToken);
        nativeMutationToken = null;
        if (identity !== navigationIdentity.current) return;
      }
      await refreshProjects();
      if (identity !== navigationIdentity.current) return;
      if (archived) {
        showToast(
          'Project archived',
          result.projectRevision
            ? {
                label: 'Undo',
                run: () => void setProjectArchived(projectPath, false, result.projectRevision!),
              }
            : undefined,
        );
      } else {
        showToast('Project restored');
      }
    } catch (reason) {
      if (nativeMutationToken !== null) await persistence.cancelNativeMutation(nativeMutationToken);
      if (identity === navigationIdentity.current)
        setError(reason instanceof Error ? reason.message : 'Project archive state could not be changed.');
    }
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
  function acknowledgeWhatsNew() {
    setShowWhatsNew(false);
    const version = updateStatus?.currentVersion;
    if (!version) return;
    dismissedWhatsNewVersion.current = version;
    void preferences
      .saveUpdates({ ...preferences.settings.updates, whatsNewAcknowledgedVersion: version })
      // Closing this optional guidance must not block the app. A failed save is retried on the next launch.
      .catch(() => undefined);
  }
  function handleWhatsNewAction(action: WhatsNewAction) {
    acknowledgeWhatsNew();
    if (!action) return;
    if (action.kind === 'onboarding') {
      setShowOnboarding(true);
      return;
    }
    setSettingsCategory(action.category);
    void navigate('settings');
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
    setSearchScope(useAppStore.getState().view === 'archived' ? 'archived' : 'active');
    setSearchDialogOpen(true);
  }
  async function openSearchTarget(target: ProjectSearchTarget) {
    const previousLocation = currentLocation();
    if (
      !(await guardedSnapshot(
        () => window.imnota.loadProject(target.projectPath),
        'Opening the search result',
        false,
      ))
    )
      throw new Error('The result could not be opened.');
    const state = useAppStore.getState();
    if (
      target.collectionId &&
      state.snapshot?.project.collections.some((entry) => entry.id === target.collectionId)
    )
      state.setActiveCollection(target.collectionId);
    if (
      target.itemId &&
      state.snapshot &&
      orderedCollectionItems(state.snapshot.project, state.activeCollectionId).some(
        (item) => item.id === target.itemId,
      )
    )
      state.set({ activeScreenshotId: target.itemId });
    setSelectedAnnotationId(target.annotationId ?? null);
    setPendingSearchAnnotationId(target.annotationId ?? null);
    setNavigationStack((stack) =>
      pushNavigationLocation(replaceNavigationLocation(stack, previousLocation), currentLocation()),
    );
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
  const activeCaptureCollection = store.snapshot?.project.collections.find(
    (item) => item.id === store.activeCollectionId,
  );
  const captureEnabled =
    preferences.settings.capture.experimentalRegionCapture &&
    platform !== 'linux' &&
    Boolean(activeCaptureCollection);
  const captureDisabledLabel =
    platform === 'linux'
      ? 'Screen capture is unavailable on Linux — use Import or Paste'
      : !activeCaptureCollection
        ? 'Choose a collection before capturing'
        : 'Screen capture is off — enable it in Settings → Features';
  const orderedShots = useMemo(
    () => (store.snapshot ? orderedCollectionItems(store.snapshot.project, store.activeCollectionId) : []),
    [store.activeCollectionId, store.snapshot],
  );
  function selectTool(next: ToolChoice): void {
    setTool(next);
    if (next !== 'select' && next !== 'eraser') lastAnnotateTool.current = next;
  }
  const handlers: Partial<Record<ShortcutActionId, (event: KeyboardEvent) => void>> = {
    'project.new': () => setDialog('new-project'),
    'project.open': () => void openProjectDialog(),
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
    'capture.region': () => {
      void captureRegion();
    },
    'capture.repeatLastRegion': () => {
      if (captureEnabled) void captureRegion(undefined, true);
    },
    'edit.deleteAnnotation': () => {
      if (selectedAnnotationId) {
        changeAnnotations(persistence.annotations.filter((item) => item.id !== selectedAnnotationId));
        setSelectedAnnotationId(null);
      }
    },
    'tool.select': () => selectTool('select'),
    'tool.text': () => selectTool('text'),
    'tool.arrow': () => selectTool('arrow'),
    'tool.rectangle': () => selectTool('rectangle'),
    'tool.highlight': () => selectTool('highlight'),
    'tool.step': () => selectTool('step'),
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
  const captureRegionRef = useRef(captureRegion);
  captureRegionRef.current = captureRegion;
  useEffect(
    () =>
      window.imnota.onRegionCaptureHotkey(() => {
        void captureRegionRef.current();
      }),
    [],
  );
  useEffect(() => {
    const unsubscribe = window.imnota.onCaptureTray((mode) => {
      void captureRegionRef.current(undefined, false, mode);
    });
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (booting || preferences.loading) return;
    void window.imnota.captureRendererReady();
  }, [booting, preferences.loading]);

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
        saveState={
          persistence.saveState === 'error' || contentPersistence.saveState === 'error'
            ? 'error'
            : persistence.saveState === 'saving' || contentPersistence.saveState === 'saving'
              ? 'saving'
              : 'saved'
        }
        onRetrySave={contentPersistence.saveState === 'error' ? contentPersistence.retry : undefined}
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
        renderUpdateControl={(placement) => (
          <FloatingUpdateControl
            status={updateStatus}
            placement={placement}
            onDownload={downloadUpdate}
            onCheck={() =>
              window.imnota.checkForUpdates().catch(() => setError('Could not check for updates. Try again.'))
            }
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
        )}
      >
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
            activeCategory={settingsCategory}
            onCategoryChange={setSettingsCategory}
            preferences={preferences.settings}
            effectiveAppearance={appearance}
            savingPreferences={preferences.saving}
            preferenceError={preferences.error}
            onAppearanceChange={preferences.saveAppearance}
            onShortcutChange={preferences.saveShortcuts}
            onWorkbenchChange={preferences.saveWorkbench}
            nativeCopyAvailable={preferences.capabilities.windowsFileClipboard}
            globalCaptureShortcutRegistered={preferences.capabilities.globalCaptureShortcutRegistered}
            onNativeCopyChange={preferences.saveNativeCopy}
            onPromptExportChange={preferences.savePromptExport}
            onExportPresetChange={async (update) => {
              await preferences.save(update);
            }}
            projects={store.projects}
            onBackupChange={preferences.saveBackups}
            onBeforeBackupAction={prepareBackupAction}
            onBackupRestoreFailed={() => setProjectSessionGeneration((generation) => generation + 1)}
            onBackupRestored={async (result) => {
              const previousLocation = currentLocation();
              ++navigationIdentity.current;
              clearSearchSelection();
              const restoreNotices = [
                ...new Set([
                  ...(result.warnings ?? []),
                  ...(result.rollbackPath
                    ? [`The full pre-restore project remains recoverable at ${result.rollbackPath}.`]
                    : []),
                  ...(result.openError
                    ? [
                        `Restore committed at ${result.projectPath}, but the project could not be reopened: ${result.openError}`,
                      ]
                    : []),
                ]),
              ];
              persistence.discardRestoredProject(result.projectPath);
              contentPersistence.reset();
              setHistory([]);
              setRedo([]);
              setDescriptionHistory({});
              setSelectedAnnotationId(null);
              copiedAnnotation.current = null;
              setProjectSessionGeneration((generation) => generation + 1);
              if (!result.snapshot) {
                useAppStore.getState().set({ snapshot: null, activeScreenshotId: null });
                setSnapshotNotice({
                  projectPath: result.projectPath,
                  warnings: restoreNotices,
                });
                await refreshProjects();
                return;
              }
              adoptSnapshot({
                ...result.snapshot,
                warnings: [...new Set([...(result.snapshot.warnings ?? []), ...restoreNotices])],
              });
              useAppStore.getState().set({ view: 'workspace' });
              useAppStore.getState().recordCollectionOpen();
              setNavigationStack((stack) =>
                pushNavigationLocation(replaceNavigationLocation(stack, previousLocation), currentLocation()),
              );
              await refreshProjects();
              showToast(
                result.mode === 'new'
                  ? 'Snapshot restored as a new project'
                  : 'Project restored with a safety snapshot',
              );
            }}
            onCaptureChange={preferences.saveCapture}
            onAgentAccessChange={preferences.saveAgentAccess}
            onReplayOnboarding={() => setShowOnboarding(true)}
            onDownload={downloadUpdate}
            updateStatus={updateStatus}
            onReplayWhatsNew={() => setShowWhatsNew(true)}
            onWhatsNewAction={handleWhatsNewAction}
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
            onDelete={requestProjectDeletion}
            onSearch={openProjectSearch}
            onBrowseProjects={() => navigate('projects')}
            onSelectContentResult={openContentSearchResult}
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
            onDrawingDescription={(description) => {
              const current = useAppStore.getState().snapshot?.project;
              if (!current) return;
              queueProjectSave({
                ...current,
                contentItems: current.contentItems?.map((item) =>
                  item.id === store.activeScreenshotId && item.kind === 'drawing'
                    ? { ...item, description }
                    : item,
                ),
              });
            }}
            screenshotFirstAdd={preferences.settings.workbench.screenshotFirstAdd}
            image={persistence.image}
            annotations={persistence.annotations}
            selectedAnnotationId={selectedAnnotationId}
            revealAnnotationId={pendingSearchAnnotationId}
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
            onTool={selectTool}
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
            onCapture={captureEnabled ? (delaySeconds) => void captureRegion(delaySeconds) : undefined}
            capturePrimary={platform === 'windows'}
            captureEnabled={captureEnabled}
            captureInProgress={capturing}
            captureShortcut={
              resolvedShortcuts['capture.region'] ? shortcutLabel('capture.region') : undefined
            }
            captureDisabledLabel={captureDisabledLabel}
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
            onDeleteItem={(id, kind) =>
              kind === 'screenshot' ? requestScreenshotDeletion(id) : requestContentDeletion(id)
            }
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
      {toast && !visibleError && (
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
      {visibleError && (
        <div className="toast error-toast" role="alert" data-testid="error-toast">
          <CircleAlert size={16} aria-hidden="true" />
          <span>{userFacingErrorMessage(visibleError)}</span>
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
      <AppDialogs
        dialog={dialog}
        newProject={newProject}
        editProject={editProject ?? undefined}
        deleteProjectName={projectToDelete?.name}
        shortcuts={preferences.settings.shortcuts}
        currentVersion={updateStatus?.currentVersion}
        busy={dialogBusy}
        onNewProjectChange={setNewProject}
        onEditProjectChange={setEditProject}
        onSaveProjectEdits={saveProjectEdits}
        onCreateProject={createProject}
        onDeleteProject={deleteProject}
        onShortcutChange={preferences.saveShortcuts}
        onClose={() => {
          setDialog(null);
          setProjectToDelete(null);
        }}
      />
      {captureDisplayChoices && (
        <CaptureDisplayDialog
          displays={captureDisplayChoices}
          onSelect={(displayId) => settleCaptureDisplayChoice(displayId)}
          onCancel={() => settleCaptureDisplayChoice(null)}
        />
      )}
      {captureDestinationOptions && (
        <CaptureDestinationDialog
          choices={captureDestinationOptions}
          onSelect={(destination) => settleCaptureDestinationChoice(destination)}
          onCancel={() => settleCaptureDestinationChoice(null)}
        />
      )}
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
      <PromptBundleDialogHost
        controller={promptBundles}
        onError={setError}
        fileClipboardAvailable={preferences.capabilities.windowsFileClipboard}
        defaultCopyVariant={preferences.settings.nativeCopy.defaultFunction}
        onDefaultCopyVariantChange={(defaultFunction) => preferences.saveNativeCopy({ defaultFunction })}
      />
      <SearchDialog
        open={searchDialogOpen}
        scope={searchScope}
        onScopeChange={setSearchScope}
        onClose={() => setSearchDialogOpen(false)}
        onOpenResult={openSearchTarget}
      />
      {showOnboarding && (
        <OnboardingDemo
          fileClipboardAvailable={preferences.capabilities.windowsFileClipboard}
          defaultCopyVariant={preferences.settings.nativeCopy.defaultFunction}
          onDefaultCopyVariantChange={(defaultFunction) => preferences.saveNativeCopy({ defaultFunction })}
          onPrepareHandoff={({ markdown, imageDataUrl, markdownFilename, filename }) =>
            window.imnota.prepareOnboardingHandoff({
              markdown,
              imageDataUrl,
              markdownFilename,
              pngFilename: filename,
            })
          }
          onCopyHandoff={(grant, action) =>
            window.imnota.copyOnboardingHandoff({ sessionId: grant.sessionId, action })
          }
          onOpenHandoff={(grant, target) =>
            window.imnota.openOnboardingHandoff({ sessionId: grant.sessionId, target })
          }
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
      {!showOnboarding && showWhatsNew && whatsNewRelease && (
        <WhatsNewDialog
          release={whatsNewRelease}
          onClose={acknowledgeWhatsNew}
          onLater={acknowledgeWhatsNew}
          onAction={handleWhatsNewAction}
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

function isMissingNavigationTargetError(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  const code = (reason as Error & { code?: unknown }).code;
  return (
    code === 'ENOENT' ||
    /\b(enoent|not found|missing|no such file)\b/i.test(reason.message) ||
    /selected project folder is unavailable/i.test(reason.message)
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
  onDelete,
  onSearch,
  onBrowseProjects,
  onSelectContentResult,
}: {
  onOpenCollection(projectPath: string, collectionId: string): void | Promise<void>;
  onNew(): void;
  onOpen(): void;
  onSelect(projectPath: string): void;
  onEdit(projectPath: string): void;
  onArchive(projectPath: string): void;
  onRestore(projectPath: string): void;
  onDelete(projectPath: string): void;
  onSearch(): void | Promise<void>;
  onBrowseProjects(): void | Promise<void>;
  onSelectContentResult(result: ContentSearchResult): void;
}) {
  const { projects, search, set, view, settings, recentCollections } = useAppStore();
  const recent = resolveRecentCollections(projects, recentCollections).filter((entry) =>
    `${entry.name} ${entry.projectName}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const normalizedQuery = search.trim();
  const filtered = projects.filter((project) => {
    if (view === 'archived') return project.status === 'archived';
    return project.status !== 'archived' && (view !== 'favourites' || project.favourite);
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
      {view === 'recent' ? (
        <div className="search-line">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Filter recent collections"
            placeholder="Filter recent collections and projects"
            value={search}
            onChange={(event) => set({ search: event.target.value })}
          />
          {search && (
            <button className="search-clear" type="button" onClick={() => set({ search: '' })}>
              Clear filter
            </button>
          )}
        </div>
      ) : (
        <>
          <button
            className="search-line library-search-trigger"
            type="button"
            data-testid="library-full-search"
            onClick={() => void onSearch()}
          >
            <Search size={16} aria-hidden="true" />
            <span>Search workspace</span>
          </button>
          <div className="search-line">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Search projects"
              placeholder="Filter projects and local content"
              maxLength={500}
              value={search}
              onChange={(event) => set({ search: event.target.value })}
            />
            {search && (
              <button className="search-clear" type="button" onClick={() => set({ search: '' })}>
                Clear search
              </button>
            )}
          </div>
        </>
      )}
      {view === 'recent' ? (
        recent.length ? (
          <div className="project-list">
            {recent.map((entry) => (
              <button
                className="project-row"
                key={`${entry.projectPath}:${entry.id}`}
                onClick={() => void onOpenCollection(entry.projectPath, entry.id)}
                title={collectionDisplayName(entry.name, entry.projectPath, entry.otherCollectionNames)}
              >
                <div className="project-symbol">
                  <ProjectIcon icon={entry.icon} />
                </div>
                <div className="project-row-copy">
                  <strong>
                    {collectionDisplayName(entry.name, entry.projectPath, entry.otherCollectionNames)}
                  </strong>
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
              !search ? <Button onClick={() => void onBrowseProjects()}>Browse projects</Button> : undefined
            }
          />
        )
      ) : normalizedQuery && settings.workspacePath ? (
        <ContentSearchResults
          query={normalizedQuery}
          workspacePath={settings.workspacePath}
          projects={projects}
          favouritesOnly={view === 'favourites'}
          scope={view === 'archived' ? 'archived' : 'active'}
          onSelect={onSelectContentResult}
        />
      ) : filtered.length ? (
        <div className="project-list">
          {filtered.map((project) => (
            <div className="project-row" key={project.id}>
              <button className="project-row-main" onClick={() => onSelect(project.projectPath)}>
                <div className="project-symbol">
                  <ProjectIcon icon={project.icon} />
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
                <IconButton
                  data-testid={`project-edit-${project.id}`}
                  label={`Edit ${project.name}`}
                  onClick={() => onEdit(project.projectPath)}
                >
                  <Pencil size={15} aria-hidden="true" />
                </IconButton>
                {project.status === 'archived' ? (
                  <IconButton
                    data-testid={`project-restore-${project.id}`}
                    label={`Restore ${project.name}`}
                    onClick={() => onRestore(project.projectPath)}
                  >
                    <ArchiveRestore size={15} aria-hidden="true" />
                  </IconButton>
                ) : (
                  <IconButton
                    data-testid={`project-archive-${project.id}`}
                    label={`Archive ${project.name}`}
                    onClick={() => onArchive(project.projectPath)}
                  >
                    <Archive size={15} aria-hidden="true" />
                  </IconButton>
                )}
                <IconButton
                  data-testid={`project-delete-${project.id}`}
                  className="project-row-delete"
                  label={`Delete ${project.name}`}
                  onClick={() => onDelete(project.projectPath)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FolderOpen size={22} aria-hidden="true" />}
          title={
            view === 'favourites'
              ? 'No favourite projects yet'
              : view === 'archived'
                ? 'No archived projects'
                : 'Your project library is empty'
          }
          description={
            view === 'favourites'
              ? 'Open a project and use the heart button to keep it here.'
              : view === 'archived'
                ? 'Archived projects stay here until you restore them.'
                : 'Create a local project, then add the screenshots that explain the work.'
          }
          action={
            view !== 'favourites' && view !== 'archived' ? (
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
