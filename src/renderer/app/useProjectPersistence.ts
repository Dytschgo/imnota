import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Annotation,
  ImagePayload,
  ProjectData,
  ProjectSnapshot,
  ScreenshotRecord,
} from '../../shared/types';
import { getRendererBridge, workflowMessage, workflowValue, WorkflowRequestError } from './workflow';

export type SaveState = 'saved' | 'saving' | 'error';

interface EditorDraft {
  key: string;
  projectPath: string;
  screenshot: ScreenshotRecord;
  image: ImagePayload;
  annotations: Annotation[];
  contentRevision: string;
  editRevision: number;
  savedRevision: number;
  lastAccess: number;
}

interface RevisionBearingResult {
  projectRevision?: string;
  warnings?: string[];
}

export interface ExternalProjectChange {
  kind: 'external-change' | 'watch-error' | 'metadata-conflict';
  message: string;
}

export interface ProjectPersistenceOptions {
  snapshot: ProjectSnapshot | null;
  activeScreenshot: ScreenshotRecord | null;
  onProject(project: ProjectData): void;
  onSnapshot(snapshot: ProjectSnapshot): void;
  onSelectScreenshot(id: string): void;
}

export interface ProjectPersistenceController {
  image: ImagePayload | null;
  annotations: Annotation[];
  loadedScreenshotId: string | null;
  saveState: SaveState;
  error: string;
  warning: string;
  externalChange: ExternalProjectChange | null;
  projectRevision: string | null;
  hasUnsavedChanges: boolean;
  hasPendingProjectMetadata(): boolean;
  changeAnnotations(next: Annotation[]): void;
  markScreenshotDirty(screenshot: ScreenshotRecord): void;
  markProjectMetadataDirty(): void;
  flush(): Promise<boolean>;
  saveProjectMetadata(project: ProjectData): Promise<boolean>;
  acceptMutationSnapshot(snapshot: ProjectSnapshot, selectScreenshotId?: string): Promise<boolean>;
  getSavedContext(collectionId: string): Promise<{ snapshot: ProjectSnapshot; collectionId: string }>;
  reloadExternal(options?: { discardLocalChanges?: boolean }): Promise<boolean>;
  dismissExternalChange(): void;
  clearError(): void;
  clearWarning(): void;
}

function draftKey(projectPath: string, screenshotId: string): string {
  return `${projectPath}\u0000${screenshotId}`;
}

function mergeContentMutation(
  local: ProjectData | undefined,
  server: ProjectData,
  savedScreenshotId: string,
  currentScreenshot: ScreenshotRecord,
  preserveCurrent: boolean,
): ProjectData {
  if (!local) return server;
  return {
    ...server,
    name: local.name,
    description: local.description,
    status: local.status,
    favourite: local.favourite,
    collections: local.collections,
    exportPreferences: local.exportPreferences,
    screenshots: server.screenshots.map((serverShot) => {
      if (serverShot.id === savedScreenshotId) return preserveCurrent ? currentScreenshot : serverShot;
      return serverShot;
    }),
  };
}

function mergeNewerEditableScreenshot(
  server: ScreenshotRecord,
  savedSource: ScreenshotRecord,
  current: ScreenshotRecord,
): ScreenshotRecord {
  return {
    ...server,
    title: current.title !== savedSource.title ? current.title : server.title,
    description: current.description !== savedSource.description ? current.description : server.description,
    priority: current.priority !== savedSource.priority ? current.priority : server.priority,
    updatedAt: current.updatedAt !== savedSource.updatedAt ? current.updatedAt : server.updatedAt,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeField<T>(base: T, intended: T, latest: T): T {
  return !sameValue(intended, base) && sameValue(latest, base) ? intended : latest;
}

function mergeProjectMetadataForCas(
  base: ProjectData,
  intended: ProjectData,
  latest: ProjectData,
): ProjectData {
  const baseCollections = new Map(base.collections.map((item) => [item.id, item]));
  const intendedCollections = new Map(intended.collections.map((item) => [item.id, item]));
  const baseScreenshots = new Map(base.screenshots.map((item) => [item.id, item]));
  const intendedScreenshots = new Map(intended.screenshots.map((item) => [item.id, item]));
  return {
    ...latest,
    name: mergeField(base.name, intended.name, latest.name),
    description: mergeField(base.description, intended.description, latest.description),
    updatedAt: mergeField(base.updatedAt, intended.updatedAt, latest.updatedAt),
    status: mergeField(base.status, intended.status, latest.status),
    favourite: mergeField(base.favourite, intended.favourite, latest.favourite),
    exportPreferences: mergeField(
      base.exportPreferences,
      intended.exportPreferences,
      latest.exportPreferences,
    ),
    collections: latest.collections.map((latestCollection) => {
      const baseCollection = baseCollections.get(latestCollection.id);
      const intendedCollection = intendedCollections.get(latestCollection.id);
      if (!baseCollection || !intendedCollection) return latestCollection;
      return {
        ...latestCollection,
        name: mergeField(baseCollection.name, intendedCollection.name, latestCollection.name),
        archived: mergeField(baseCollection.archived, intendedCollection.archived, latestCollection.archived),
        overallContext: mergeField(
          baseCollection.overallContext,
          intendedCollection.overallContext,
          latestCollection.overallContext,
        ),
        updatedAt: mergeField(
          baseCollection.updatedAt,
          intendedCollection.updatedAt,
          latestCollection.updatedAt,
        ),
      };
    }),
    screenshots: latest.screenshots.map((latestScreenshot) => {
      const baseScreenshot = baseScreenshots.get(latestScreenshot.id);
      const intendedScreenshot = intendedScreenshots.get(latestScreenshot.id);
      if (!baseScreenshot || !intendedScreenshot) return latestScreenshot;
      return {
        ...latestScreenshot,
        collectionId: mergeField(
          baseScreenshot.collectionId,
          intendedScreenshot.collectionId,
          latestScreenshot.collectionId,
        ),
        title: mergeField(baseScreenshot.title, intendedScreenshot.title, latestScreenshot.title),
        description: mergeField(
          baseScreenshot.description,
          intendedScreenshot.description,
          latestScreenshot.description,
        ),
        position: mergeField(baseScreenshot.position, intendedScreenshot.position, latestScreenshot.position),
        priority: mergeField(baseScreenshot.priority, intendedScreenshot.priority, latestScreenshot.priority),
        includeInExport: mergeField(
          baseScreenshot.includeInExport,
          intendedScreenshot.includeInExport,
          latestScreenshot.includeInExport,
        ),
        updatedAt: mergeField(
          baseScreenshot.updatedAt,
          intendedScreenshot.updatedAt,
          latestScreenshot.updatedAt,
        ),
      };
    }),
  };
}

export function useProjectPersistence({
  snapshot,
  activeScreenshot,
  onProject,
  onSnapshot,
  onSelectScreenshot,
}: ProjectPersistenceOptions): ProjectPersistenceController {
  const callbacks = useRef({ onProject, onSnapshot, onSelectScreenshot });
  callbacks.current = { onProject, onSnapshot, onSelectScreenshot };
  const drafts = useRef(new Map<string, EditorDraft>());
  const inFlight = useRef(new Map<string, Promise<boolean>>());
  const accessCounter = useRef(0);
  const snapshotRef = useRef<ProjectSnapshot | null>(snapshot);
  const lastPropSnapshot = useRef<ProjectSnapshot | null>(snapshot);
  if (snapshot !== lastPropSnapshot.current) {
    lastPropSnapshot.current = snapshot;
    snapshotRef.current = snapshot;
  }
  const lastSavedSnapshot = useRef<ProjectSnapshot | null>(snapshot);
  const activeKey = snapshot && activeScreenshot ? draftKey(snapshot.projectPath, activeScreenshot.id) : null;
  const activeKeyRef = useRef<string | null>(activeKey);
  activeKeyRef.current = activeKey;
  const loadIdentity = useRef(0);
  const watchId = useRef<string | null>(null);
  const acceptedRevision = useRef<string | null>(null);
  const ownRevisionGeneration = useRef(0);
  const watchReady = useRef<Promise<boolean>>(Promise.resolve(false));
  const metadataDirty = useRef(false);
  const pendingMetadataProject = useRef<ProjectData | null>(null);
  const metadataSave = useRef<Promise<boolean> | null>(null);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [externalChange, setExternalChange] = useState<ExternalProjectChange | null>(null);
  const [projectRevision, setProjectRevision] = useState<string | null>(null);

  useEffect(() => {
    if (!snapshot) {
      lastSavedSnapshot.current = null;
      return;
    }
    if (!metadataDirty.current) lastSavedSnapshot.current = snapshot;
  }, [snapshot]);

  const publishAcceptedRevision = useCallback((revision: string | null) => {
    acceptedRevision.current = revision;
    setProjectRevision(revision);
  }, []);

  const hasDirtyDrafts = useCallback(
    (projectPath?: string) =>
      [...drafts.current.values()].some(
        (item) =>
          (!projectPath || item.projectPath === projectPath) && item.editRevision !== item.savedRevision,
      ),
    [],
  );

  const evictCleanDrafts = useCallback(() => {
    const clean = [...drafts.current.values()]
      .filter((item) => item.editRevision === item.savedRevision && item.key !== activeKeyRef.current)
      .sort((left, right) => right.lastAccess - left.lastAccess);
    const activeIsClean = activeKeyRef.current
      ? drafts.current.get(activeKeyRef.current)?.editRevision ===
        drafts.current.get(activeKeyRef.current)?.savedRevision
      : false;
    const keepOther = activeIsClean ? 1 : 2;
    for (const item of clean.slice(keepOther)) drafts.current.delete(item.key);
  }, []);

  const setCurrentDraft = useCallback(
    (next: EditorDraft) => {
      const accessed = { ...next, lastAccess: ++accessCounter.current };
      drafts.current.set(accessed.key, accessed);
      if (activeKeyRef.current === accessed.key) setDraft(accessed);
      evictCleanDrafts();
    },
    [evictCleanDrafts],
  );

  useEffect(() => {
    const identity = ++loadIdentity.current;
    if (!snapshot || !activeScreenshot || !activeKey) {
      setDraft(null);
      evictCleanDrafts();
      return;
    }
    const retained = drafts.current.get(activeKey);
    if (retained) {
      const synced = {
        ...retained,
        screenshot: retained.editRevision === retained.savedRevision ? activeScreenshot : retained.screenshot,
        lastAccess: ++accessCounter.current,
      };
      drafts.current.set(activeKey, synced);
      setDraft(synced);
      setSaveState(synced.editRevision === synced.savedRevision ? 'saved' : 'saving');
      evictCleanDrafts();
      return;
    }
    setDraft(null);
    void getRendererBridge()
      .loadScreenshotContent({ projectPath: snapshot.projectPath, screenshot: activeScreenshot })
      .then((content) => {
        if (identity !== loadIdentity.current || activeKeyRef.current !== activeKey) return;
        const next: EditorDraft = {
          key: activeKey,
          projectPath: snapshot.projectPath,
          screenshot: { ...activeScreenshot, description: content.description },
          image: content.image,
          annotations: content.annotations,
          contentRevision: content.contentRevision,
          editRevision: 0,
          savedRevision: 0,
          lastAccess: ++accessCounter.current,
        };
        setCurrentDraft(next);
        setSaveState('saved');
        if (content.description !== activeScreenshot.description)
          callbacks.current.onProject({
            ...snapshot.project,
            screenshots: snapshot.project.screenshots.map((item) =>
              item.id === activeScreenshot.id ? { ...item, description: content.description } : item,
            ),
          });
      })
      .catch((reason) => setError(workflowMessage(reason, 'The screenshot could not be loaded.')));
  }, [activeKey, activeScreenshot, evictCleanDrafts, setCurrentDraft, snapshot]);

  const saveKey = useCallback(
    (key: string): Promise<boolean> => {
      const originalKey = key;
      const existing = inFlight.current.get(key);
      if (existing) return existing;
      const operationHolder: { current?: Promise<boolean> } = {};
      const operation = (async () => {
        setError('');
        while (true) {
          const source = drafts.current.get(key);
          if (!source || source.editRevision === source.savedRevision) return true;
          if (activeKeyRef.current === key) setSaveState('saving');
          const saveRevision = source.editRevision;
          try {
            const result = await getRendererBridge().saveScreenshotContent({
              projectPath: source.projectPath,
              screenshot: structuredClone(source.screenshot),
              annotations: structuredClone(source.annotations),
              contentRevision: source.contentRevision,
            });
            const current = drafts.current.get(key);
            if (!current) return true;
            const resultRevision = (result as typeof result & RevisionBearingResult).projectRevision;
            const resultWarnings = (result as typeof result & RevisionBearingResult).warnings;
            if (resultWarnings?.length) setWarning(`Saved with a warning: ${resultWarnings.join(' ')}`);
            ownRevisionGeneration.current += 1;
            if (result.conflictCreated) {
              publishAcceptedRevision(null);
              const conflictKey = draftKey(source.projectPath, result.savedScreenshotId);
              const serverShot = result.project.screenshots.find(
                (item) => item.id === result.savedScreenshotId,
              );
              if (!serverShot)
                throw new Error('The native save did not return the created Copy conflict record.');
              const hasNewerEdits = current.editRevision > saveRevision;
              const conflictDraft: EditorDraft = {
                ...current,
                key: conflictKey,
                screenshot: hasNewerEdits
                  ? mergeNewerEditableScreenshot(serverShot, source.screenshot, current.screenshot)
                  : serverShot,
                contentRevision: result.contentRevision,
                savedRevision: saveRevision,
                lastAccess: ++accessCounter.current,
              };
              drafts.current.set(conflictKey, conflictDraft);
              drafts.current.delete(key);
              if (operationHolder.current) inFlight.current.set(conflictKey, operationHolder.current);
              callbacks.current.onSelectScreenshot(result.savedScreenshotId);
              const currentSnapshot = snapshotRef.current;
              const sourceThumb = currentSnapshot?.thumbnails[source.screenshot.id];
              const nextSnapshot = currentSnapshot
                ? {
                    ...currentSnapshot,
                    project: mergeContentMutation(
                      currentSnapshot.project,
                      result.project,
                      result.savedScreenshotId,
                      conflictDraft.screenshot,
                      hasNewerEdits,
                    ),
                    thumbnails: sourceThumb
                      ? { ...currentSnapshot.thumbnails, [result.savedScreenshotId]: sourceThumb }
                      : currentSnapshot.thumbnails,
                  }
                : null;
              if (nextSnapshot) {
                snapshotRef.current = nextSnapshot;
                callbacks.current.onSnapshot(nextSnapshot);
              }
              setExternalChange({
                kind: 'external-change',
                message:
                  'External edits were preserved. Your work is in an excluded Copy conflict for review.',
              });
              setCurrentDraft(conflictDraft);
              key = conflictKey;
              continue;
            }
            if (resultRevision) publishAcceptedRevision(resultRevision);
            else publishAcceptedRevision(null);
            const serverShot = result.project.screenshots.find((item) => item.id === source.screenshot.id);
            const hasNewerEdits = current.editRevision > saveRevision;
            const next: EditorDraft = {
              ...current,
              screenshot: hasNewerEdits ? current.screenshot : (serverShot ?? current.screenshot),
              contentRevision: result.contentRevision,
              savedRevision: Math.max(current.savedRevision, saveRevision),
              lastAccess: ++accessCounter.current,
            };
            drafts.current.set(key, next);
            const currentSnapshot = snapshotRef.current;
            if (currentSnapshot?.projectPath === source.projectPath) {
              const merged = mergeContentMutation(
                currentSnapshot.project,
                result.project,
                source.screenshot.id,
                next.screenshot,
                hasNewerEdits,
              );
              const mergedSnapshot = { ...currentSnapshot, project: merged };
              snapshotRef.current = mergedSnapshot;
              if (!metadataDirty.current) lastSavedSnapshot.current = mergedSnapshot;
              callbacks.current.onProject(merged);
            }
            if (activeKeyRef.current === key) {
              setDraft(next);
              setSaveState(next.editRevision === next.savedRevision ? 'saved' : 'saving');
            }
            evictCleanDrafts();
            if (next.editRevision === next.savedRevision) return true;
          } catch (reason) {
            if (activeKeyRef.current === key) setSaveState('error');
            setError(
              workflowMessage(
                reason,
                `Could not save ${source.screenshot.title || source.screenshot.originalFilename}. Keep Imnota open and check the workspace.`,
              ),
            );
            return false;
          }
        }
      })().finally(() => {
        for (const [trackedKey, pending] of inFlight.current) {
          if (trackedKey === originalKey || pending === operationHolder.current)
            inFlight.current.delete(trackedKey);
        }
      });
      operationHolder.current = operation;
      inFlight.current.set(key, operation);
      return operation;
    },
    [evictCleanDrafts, publishAcceptedRevision, setCurrentDraft],
  );

  const flush = useCallback(async () => {
    const key = activeKeyRef.current;
    if (!key) return true;
    while (true) {
      if (!(await saveKey(key))) return false;
      const current = drafts.current.get(activeKeyRef.current ?? key);
      if (!current || current.editRevision === current.savedRevision) return true;
    }
  }, [saveKey]);

  useEffect(() => {
    if (!draft || draft.editRevision === draft.savedRevision) return;
    const timer = window.setTimeout(() => void saveKey(draft.key), 650);
    return () => window.clearTimeout(timer);
  }, [draft, saveKey]);

  useEffect(() => {
    const bridge = getRendererBridge();
    const projectPath = snapshot?.projectPath;
    let cancelled = false;
    publishAcceptedRevision(null);
    setExternalChange(null);
    let resolveReady!: (ready: boolean) => void;
    watchReady.current = new Promise((resolve) => {
      resolveReady = resolve;
    });
    if (!projectPath) {
      resolveReady(false);
      return;
    }
    if (typeof bridge.startProjectWatch !== 'function' || typeof bridge.onProjectWatchEvent !== 'function') {
      resolveReady(false);
      setExternalChange({
        kind: 'watch-error',
        message: 'Safe project change monitoring is unavailable in this build.',
      });
      return;
    }
    const generationAtStart = ownRevisionGeneration.current;
    void bridge
      .startProjectWatch({ projectPath })
      .then(workflowValue)
      .then((grant) => {
        if (cancelled) {
          void bridge.stopProjectWatch({ watchId: grant.watchId });
          resolveReady(false);
          return;
        }
        watchId.current = grant.watchId;
        if (ownRevisionGeneration.current === generationAtStart)
          publishAcceptedRevision(grant.projectRevision);
        resolveReady(true);
      })
      .catch((reason) => {
        resolveReady(false);
        setExternalChange({
          kind: 'watch-error',
          message: workflowMessage(reason, 'External project changes cannot be monitored right now.'),
        });
      });
    const unsubscribe = bridge.onProjectWatchEvent((event) => {
      if (event.watchId !== watchId.current) return;
      if (event.kind === 'watch-error') {
        setExternalChange({ kind: 'watch-error', message: event.message ?? 'Project monitoring stopped.' });
        return;
      }
      if (event.projectRevision && event.projectRevision === acceptedRevision.current) return;
      // event.projectRevision is deliberately pending-only. It is not an accepted CAS baseline until reload.
      setExternalChange({
        kind: 'external-change',
        message:
          metadataDirty.current || hasDirtyDrafts()
            ? 'This project changed outside Imnota. Your unsaved work is preserved; save or resolve it before reloading.'
            : 'This project changed outside Imnota. Reload to review the latest files.',
      });
    });
    return () => {
      cancelled = true;
      resolveReady(false);
      unsubscribe();
      const id = watchId.current;
      if (id) void bridge.stopProjectWatch({ watchId: id });
      watchId.current = null;
      publishAcceptedRevision(null);
    };
  }, [hasDirtyDrafts, publishAcceptedRevision, snapshot?.projectPath]);

  const saveProjectMetadata = useCallback(
    (project: ProjectData): Promise<boolean> => {
      pendingMetadataProject.current = project;
      metadataDirty.current = true;
      if (metadataSave.current) return metadataSave.current;
      const operation = (async () => {
        while (pendingMetadataProject.current) {
          const next = pendingMetadataProject.current;
          const baseProject = lastSavedSnapshot.current?.project;
          pendingMetadataProject.current = null;
          if (!(await flush())) return false;
          const ready = await watchReady.current;
          const id = watchId.current;
          const revision = acceptedRevision.current;
          if (!ready || !id || !revision) {
            pendingMetadataProject.current = next;
            setError(
              'Project details are waiting for the safe file watcher. Try saving again after it reconnects.',
            );
            return false;
          }
          try {
            const latestProject = snapshotRef.current?.project;
            const projectForCas =
              latestProject && baseProject
                ? mergeProjectMetadataForCas(baseProject, next, latestProject)
                : (latestProject ?? next);
            const saved = workflowValue(
              await getRendererBridge().saveProjectCompareAndSwap({
                watchId: id,
                expectedRevision: revision,
                project: projectForCas,
              }),
            );
            ownRevisionGeneration.current += 1;
            publishAcceptedRevision(saved.projectRevision);
            snapshotRef.current = saved.snapshot;
            lastSavedSnapshot.current = saved.snapshot;
            callbacks.current.onSnapshot(saved.snapshot);
          } catch (reason) {
            pendingMetadataProject.current = next;
            if (reason instanceof WorkflowRequestError && reason.workflowError.code === 'project-changed')
              setExternalChange({
                kind: 'metadata-conflict',
                message:
                  'Project details changed on disk. Your edits remain open; reload, compare, and save again.',
              });
            else setError(workflowMessage(reason, 'Project details could not be saved.'));
            return false;
          }
        }
        metadataDirty.current = false;
        return true;
      })().finally(() => {
        metadataSave.current = null;
      });
      metadataSave.current = operation;
      return operation;
    },
    [flush, publishAcceptedRevision],
  );

  const reloadExternal = useCallback(
    async (options?: { discardLocalChanges?: boolean }) => {
      if (!watchId.current) return false;
      const discardLocalChanges = options?.discardLocalChanges === true;
      if (discardLocalChanges) {
        if (metadataSave.current) await metadataSave.current;
        await Promise.allSettled([...inFlight.current.values()]);
        const projectPath = snapshotRef.current?.projectPath;
        if (projectPath) {
          for (const [key, retained] of drafts.current) {
            if (retained.projectPath === projectPath) drafts.current.delete(key);
          }
        }
        pendingMetadataProject.current = null;
        metadataDirty.current = false;
        setDraft(null);
        setSaveState('saved');
        setError('');
      } else if (
        !(await flush()) ||
        metadataDirty.current ||
        hasDirtyDrafts(snapshotRef.current?.projectPath)
      ) {
        setError('Reload was cancelled so your unsaved project details stay open. Save or undo them first.');
        return false;
      }
      try {
        const latest = workflowValue(
          await getRendererBridge().reloadWatchedProject({ watchId: watchId.current }),
        );
        const reloadedProjectPath = latest.snapshot.projectPath;
        for (const [key, retained] of drafts.current) {
          if (
            retained.projectPath === reloadedProjectPath &&
            retained.editRevision === retained.savedRevision
          )
            drafts.current.delete(key);
        }
        setDraft(null);
        publishAcceptedRevision(latest.projectRevision);
        snapshotRef.current = latest.snapshot;
        lastSavedSnapshot.current = latest.snapshot;
        callbacks.current.onSnapshot(latest.snapshot);
        setExternalChange(null);
        return true;
      } catch (reason) {
        setError(workflowMessage(reason, 'The project could not be reloaded.'));
        return false;
      }
    },
    [flush, hasDirtyDrafts, publishAcceptedRevision],
  );

  return {
    image: draft?.image ?? null,
    annotations: draft?.annotations ?? [],
    loadedScreenshotId: draft?.screenshot.id ?? null,
    saveState,
    error,
    warning,
    externalChange,
    projectRevision,
    hasUnsavedChanges: hasDirtyDrafts() || metadataDirty.current,
    hasPendingProjectMetadata: () => metadataDirty.current,
    changeAnnotations(next) {
      const current = activeKeyRef.current ? drafts.current.get(activeKeyRef.current) : undefined;
      if (!current) return;
      setCurrentDraft({ ...current, annotations: next, editRevision: current.editRevision + 1 });
    },
    markScreenshotDirty(screenshot) {
      const current = activeKeyRef.current ? drafts.current.get(activeKeyRef.current) : undefined;
      if (!current) return;
      setCurrentDraft({ ...current, screenshot, editRevision: current.editRevision + 1 });
    },
    markProjectMetadataDirty() {
      metadataDirty.current = true;
    },
    flush,
    saveProjectMetadata,
    async acceptMutationSnapshot(mutationSnapshot, selectScreenshotId) {
      let acceptedSnapshot = mutationSnapshot;
      const mutatesCurrentProject = snapshotRef.current?.projectPath === mutationSnapshot.projectPath;
      if (mutatesCurrentProject) ownRevisionGeneration.current += 1;
      const mutationRevision = (mutationSnapshot as ProjectSnapshot & RevisionBearingResult).projectRevision;
      if (mutatesCurrentProject && mutationRevision) {
        publishAcceptedRevision(mutationRevision);
        setExternalChange(null);
      } else if (mutatesCurrentProject) {
        const ready = await watchReady.current;
        const id = watchId.current;
        if (ready && id) {
          try {
            const latest = workflowValue(await getRendererBridge().reloadWatchedProject({ watchId: id }));
            acceptedSnapshot = latest.snapshot;
            publishAcceptedRevision(latest.projectRevision);
            setExternalChange(null);
          } catch (reason) {
            publishAcceptedRevision(null);
            setExternalChange({
              kind: 'watch-error',
              message: workflowMessage(
                reason,
                'The project changed, but its safe save revision could not be refreshed. Reconnect the workspace before editing project details.',
              ),
            });
          }
        } else {
          publishAcceptedRevision(null);
          setExternalChange({
            kind: 'watch-error',
            message:
              'The project changed, but safe change monitoring is not ready. Reconnect the workspace before editing project details.',
          });
        }
      }
      snapshotRef.current = acceptedSnapshot;
      lastSavedSnapshot.current = acceptedSnapshot;
      callbacks.current.onSnapshot(acceptedSnapshot);
      if (
        selectScreenshotId &&
        acceptedSnapshot.project.screenshots.some((item) => item.id === selectScreenshotId)
      )
        callbacks.current.onSelectScreenshot(selectScreenshotId);
      return !mutatesCurrentProject || acceptedRevision.current !== null;
    },
    async getSavedContext(requestedCollectionId) {
      if (!(await flush())) throw new Error('Current screenshot edits could not be saved.');
      const current = snapshotRef.current;
      if (!current) throw new Error('Open a project before preparing prompt bundles.');
      if (metadataDirty.current && !(await saveProjectMetadata(current.project)))
        throw new Error('Project details could not be saved. Prompt preparation was cancelled.');
      const saved = lastSavedSnapshot.current;
      if (!saved || !saved.project.collections.some((item) => item.id === requestedCollectionId))
        throw new Error('The selected collection is no longer available.');
      return { snapshot: structuredClone(saved), collectionId: requestedCollectionId };
    },
    reloadExternal,
    dismissExternalChange: () => setExternalChange(null),
    clearError: () => setError(''),
    clearWarning: () => setWarning(''),
  };
}
