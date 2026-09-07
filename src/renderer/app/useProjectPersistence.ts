import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Annotation,
  ImagePayload,
  ProjectData,
  ProjectSnapshot,
  ScreenshotRecord,
} from '../../shared/types';
import {
  getRendererBridge,
  screenshotSaveError,
  workflowMessage,
  workflowValue,
  WorkflowRequestError,
} from './workflow';

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

interface PendingMetadataEdit {
  generation: number;
  base: ProjectData;
  project: ProjectData;
}

interface MetadataMergeResult {
  project: ProjectData;
  conflicts: string[];
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
  queueProjectMetadata(project: ProjectData): number;
  flush(): Promise<boolean>;
  flushProjectMetadata(): Promise<boolean>;
  saveProjectMetadata(project: ProjectData): Promise<boolean>;
  beginNativeMutation(): number;
  cancelNativeMutation(token: number): Promise<boolean>;
  acceptMutationSnapshot(
    snapshot: ProjectSnapshot,
    selectScreenshotId?: string,
    nativeMutationToken?: number,
  ): Promise<boolean>;
  adoptAuthoritativeSnapshot(snapshot: ProjectSnapshot, nativeMutationToken?: number): Promise<boolean>;
  getSavedContext(collectionId: string): Promise<{ snapshot: ProjectSnapshot; collectionId: string }>;
  reloadExternal(options?: { discardLocalChanges?: boolean }): Promise<boolean>;
  dismissExternalChange(): void;
  clearError(): void;
  clearWarning(): void;
}

function draftKey(projectPath: string, screenshotId: string): string {
  return `${projectPath}\u0000${screenshotId}`;
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

function mergeField<T>(path: string, base: T, local: T, external: T, conflicts: string[]): T {
  const localChanged = !sameValue(local, base);
  const externalChanged = !sameValue(external, base);
  if (localChanged && externalChanged && !sameValue(local, external)) {
    conflicts.push(path);
    return local;
  }
  return localChanged ? local : external;
}

function mergeTrackedProjectMetadata(
  base: ProjectData,
  local: ProjectData,
  external: ProjectData,
): MetadataMergeResult {
  const conflicts: string[] = [];
  const baseCollections = new Map(base.collections.map((item) => [item.id, item]));
  const localCollections = new Map(local.collections.map((item) => [item.id, item]));
  const baseScreenshots = new Map(base.screenshots.map((item) => [item.id, item]));
  const localScreenshots = new Map(local.screenshots.map((item) => [item.id, item]));
  const project: ProjectData = {
    ...external,
    name: mergeField('project name', base.name, local.name, external.name, conflicts),
    description: mergeField(
      'project description',
      base.description,
      local.description,
      external.description,
      conflicts,
    ),
    status: mergeField('project status', base.status, local.status, external.status, conflicts),
    favourite: mergeField(
      'project favourite',
      base.favourite,
      local.favourite,
      external.favourite,
      conflicts,
    ),
    exportPreferences: mergeField(
      'export preferences',
      base.exportPreferences,
      local.exportPreferences,
      external.exportPreferences,
      conflicts,
    ),
    collections: external.collections.map((externalCollection) => {
      const baseCollection = baseCollections.get(externalCollection.id);
      const localCollection = localCollections.get(externalCollection.id);
      if (!baseCollection || !localCollection) return externalCollection;
      return {
        ...externalCollection,
        name: mergeField(
          `collection ${externalCollection.id} name`,
          baseCollection.name,
          localCollection.name,
          externalCollection.name,
          conflicts,
        ),
        archived: mergeField(
          `collection ${externalCollection.id} archive state`,
          baseCollection.archived,
          localCollection.archived,
          externalCollection.archived,
          conflicts,
        ),
        overallContext: mergeField(
          `collection ${externalCollection.id} overall context`,
          baseCollection.overallContext,
          localCollection.overallContext,
          externalCollection.overallContext,
          conflicts,
        ),
        updatedAt:
          localCollection.updatedAt !== baseCollection.updatedAt
            ? localCollection.updatedAt
            : externalCollection.updatedAt,
      };
    }),
    screenshots: external.screenshots.map((externalScreenshot) => {
      const baseScreenshot = baseScreenshots.get(externalScreenshot.id);
      const localScreenshot = localScreenshots.get(externalScreenshot.id);
      if (!baseScreenshot || !localScreenshot) return externalScreenshot;
      return {
        ...externalScreenshot,
        collectionId: mergeField(
          `screenshot ${externalScreenshot.id} collection`,
          baseScreenshot.collectionId,
          localScreenshot.collectionId,
          externalScreenshot.collectionId,
          conflicts,
        ),
        title: mergeField(
          `screenshot ${externalScreenshot.id} title`,
          baseScreenshot.title,
          localScreenshot.title,
          externalScreenshot.title,
          conflicts,
        ),
        description: mergeField(
          `screenshot ${externalScreenshot.id} description`,
          baseScreenshot.description,
          localScreenshot.description,
          externalScreenshot.description,
          conflicts,
        ),
        position: mergeField(
          `screenshot ${externalScreenshot.id} position`,
          baseScreenshot.position,
          localScreenshot.position,
          externalScreenshot.position,
          conflicts,
        ),
        priority: mergeField(
          `screenshot ${externalScreenshot.id} priority`,
          baseScreenshot.priority,
          localScreenshot.priority,
          externalScreenshot.priority,
          conflicts,
        ),
        includeInExport: mergeField(
          `screenshot ${externalScreenshot.id} prompt inclusion`,
          baseScreenshot.includeInExport,
          localScreenshot.includeInExport,
          externalScreenshot.includeInExport,
          conflicts,
        ),
        updatedAt:
          localScreenshot.updatedAt !== baseScreenshot.updatedAt
            ? localScreenshot.updatedAt
            : externalScreenshot.updatedAt,
      };
    }),
  };
  project.updatedAt = local.updatedAt !== base.updatedAt ? local.updatedAt : external.updatedAt;

  for (const [id, baseCollection] of baseCollections) {
    if (!external.collections.some((item) => item.id === id)) {
      const localCollection = localCollections.get(id);
      if (localCollection && !sameValue(localCollection, baseCollection))
        conflicts.push(`collection ${id} was removed externally`);
    }
  }
  for (const [id, baseScreenshot] of baseScreenshots) {
    if (!external.screenshots.some((item) => item.id === id)) {
      const localScreenshot = localScreenshots.get(id);
      if (localScreenshot && !sameValue(localScreenshot, baseScreenshot))
        conflicts.push(`screenshot ${id} was removed externally`);
    }
  }
  return { project, conflicts: [...new Set(conflicts)] };
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
  const lastSavedSnapshot = useRef<ProjectSnapshot | null>(snapshot);
  if (snapshot !== lastPropSnapshot.current) {
    const priorPath = snapshotRef.current?.projectPath;
    lastPropSnapshot.current = snapshot;
    snapshotRef.current = snapshot;
    if (!snapshot || snapshot.projectPath !== priorPath) lastSavedSnapshot.current = snapshot;
  }
  const activeKey = snapshot && activeScreenshot ? draftKey(snapshot.projectPath, activeScreenshot.id) : null;
  const activeKeyRef = useRef<string | null>(activeKey);
  activeKeyRef.current = activeKey;
  const loadIdentity = useRef(0);
  const watchId = useRef<string | null>(null);
  const acceptedRevision = useRef<string | null>(null);
  const ownRevisionGeneration = useRef(0);
  const watchReady = useRef<Promise<boolean>>(Promise.resolve(false));
  const metadataDirty = useRef(false);
  const metadataGeneration = useRef(0);
  const pendingMetadata = useRef<PendingMetadataEdit | null>(null);
  const metadataInFlight = useRef<PendingMetadataEdit | null>(null);
  const metadataSave = useRef<Promise<boolean> | null>(null);
  const nativeMutationGeneration = useRef(0);
  const nativeMutationTokens = useRef(new Set<number>());
  const suspendedMetadataWaiters = useRef<Array<(saved: boolean) => void>>([]);
  const pendingExternalChange = useRef<ExternalProjectChange | null>(null);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [externalChange, setExternalChange] = useState<ExternalProjectChange | null>(null);
  const [projectRevision, setProjectRevision] = useState<string | null>(null);

  const publishAcceptedRevision = useCallback((revision: string | null) => {
    acceptedRevision.current = revision;
    setProjectRevision(revision);
  }, []);

  const publishExternalChange = useCallback((change: ExternalProjectChange | null) => {
    pendingExternalChange.current = change;
    setExternalChange(change);
  }, []);

  const surfaceMetadataConflict = useCallback(
    (conflicts: string[]) => {
      publishAcceptedRevision(null);
      publishExternalChange({
        kind: 'metadata-conflict',
        message: `Project details changed in the workspace while you were editing ${conflicts
          .slice(0, 2)
          .join(
            ' and ',
          )}. Your local values remain open; reload to review the saved version before exporting or saving again.`,
      });
    },
    [publishAcceptedRevision, publishExternalChange],
  );

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

  const overlayTrackedMetadata = useCallback(
    (authoritative: ProjectData): MetadataMergeResult => {
      let project = authoritative;
      const conflicts: string[] = [];
      const inFlightEdit = metadataInFlight.current;
      if (inFlightEdit) {
        const merged = mergeTrackedProjectMetadata(inFlightEdit.base, inFlightEdit.project, project);
        conflicts.push(...merged.conflicts);
        if (!merged.conflicts.length)
          metadataInFlight.current = {
            ...inFlightEdit,
            base: project,
            project: merged.project,
          };
        project = merged.project;
      }
      const pendingEdit = pendingMetadata.current;
      if (pendingEdit) {
        const merged = mergeTrackedProjectMetadata(pendingEdit.base, pendingEdit.project, project);
        conflicts.push(...merged.conflicts);
        if (!merged.conflicts.length)
          pendingMetadata.current = {
            ...pendingEdit,
            base: project,
            project: merged.project,
          };
        project = merged.project;
      }
      const uniqueConflicts = [...new Set(conflicts)];
      if (uniqueConflicts.length) surfaceMetadataConflict(uniqueConflicts);
      return { project, conflicts: uniqueConflicts };
    },
    [surfaceMetadataConflict],
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
              const authoritativeSnapshot = currentSnapshot
                ? { ...currentSnapshot, project: result.project }
                : null;
              if (authoritativeSnapshot) lastSavedSnapshot.current = authoritativeSnapshot;
              const metadataOverlay = overlayTrackedMetadata(result.project);
              const displayProject = {
                ...metadataOverlay.project,
                screenshots: metadataOverlay.project.screenshots.map((serverScreenshot) =>
                  serverScreenshot.id === result.savedScreenshotId && hasNewerEdits
                    ? conflictDraft.screenshot
                    : serverScreenshot,
                ),
              };
              const nextSnapshot = currentSnapshot
                ? {
                    ...currentSnapshot,
                    project: displayProject,
                    thumbnails: sourceThumb
                      ? { ...currentSnapshot.thumbnails, [result.savedScreenshotId]: sourceThumb }
                      : currentSnapshot.thumbnails,
                  }
                : null;
              if (nextSnapshot) {
                snapshotRef.current = nextSnapshot;
                callbacks.current.onSnapshot(nextSnapshot);
              }
              publishExternalChange({
                kind: 'external-change',
                message:
                  'External edits were preserved. Your work is in an excluded Copy conflict for review.',
              });
              setCurrentDraft(conflictDraft);
              key = conflictKey;
              continue;
            }
            if (!pendingExternalChange.current && resultRevision) publishAcceptedRevision(resultRevision);
            else if (!resultRevision) publishAcceptedRevision(null);
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
              const authoritativeSnapshot = { ...currentSnapshot, project: result.project };
              lastSavedSnapshot.current = authoritativeSnapshot;
              const metadataOverlay = overlayTrackedMetadata(result.project);
              const displayProject = {
                ...metadataOverlay.project,
                screenshots: metadataOverlay.project.screenshots.map((item) =>
                  item.id === source.screenshot.id && hasNewerEdits ? next.screenshot : item,
                ),
              };
              const mergedSnapshot = { ...currentSnapshot, project: displayProject };
              snapshotRef.current = mergedSnapshot;
              callbacks.current.onProject(displayProject);
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
              screenshotSaveError(source.screenshot, snapshotRef.current?.project.screenshots ?? [], reason),
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
    [
      evictCleanDrafts,
      overlayTrackedMetadata,
      publishAcceptedRevision,
      publishExternalChange,
      setCurrentDraft,
    ],
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
    publishExternalChange(null);
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
      publishExternalChange({
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
        publishExternalChange({
          kind: 'watch-error',
          message: workflowMessage(reason, 'External project changes cannot be monitored right now.'),
        });
      });
    const unsubscribe = bridge.onProjectWatchEvent((event) => {
      if (event.watchId !== watchId.current) return;
      if (event.kind === 'watch-error') {
        publishExternalChange({
          kind: 'watch-error',
          message: event.message ?? 'Project monitoring stopped.',
        });
        return;
      }
      if (event.projectRevision && event.projectRevision === acceptedRevision.current) return;
      // event.projectRevision is deliberately pending-only. It is not an accepted CAS baseline until reload.
      publishExternalChange({
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
  }, [hasDirtyDrafts, publishAcceptedRevision, publishExternalChange, snapshot?.projectPath]);

  const queueProjectMetadata = useCallback((project: ProjectData): number => {
    const generation = ++metadataGeneration.current;
    const base =
      pendingMetadata.current?.base ??
      metadataInFlight.current?.project ??
      lastSavedSnapshot.current?.project ??
      snapshotRef.current?.project;
    if (!base) return generation;
    pendingMetadata.current = { generation, base: structuredClone(base), project: structuredClone(project) };
    metadataDirty.current = true;
    const currentSnapshot = snapshotRef.current;
    if (currentSnapshot) snapshotRef.current = { ...currentSnapshot, project };
    return generation;
  }, []);

  const flushProjectMetadata = useCallback((): Promise<boolean> => {
    if (metadataSave.current) return metadataSave.current;
    if (!pendingMetadata.current) return Promise.resolve(true);
    // A native mutation may already have advanced project.json while its promise is still pending.
    // Keep the concrete queued edit in memory until that mutation's authoritative revision is adopted.
    if (nativeMutationTokens.current.size)
      return new Promise<boolean>((resolve) => suspendedMetadataWaiters.current.push(resolve));
    const restoreInFlight = () => {
      const captured = metadataInFlight.current;
      if (!captured) return;
      const newer = pendingMetadata.current;
      pendingMetadata.current = newer ? { ...newer, base: captured.base } : captured;
      metadataInFlight.current = null;
      metadataDirty.current = true;
    };
    const operation = (async () => {
      while (pendingMetadata.current) {
        if (pendingExternalChange.current) {
          setError('Project details are paused until you reload and review the workspace changes.');
          return false;
        }
        const captured = pendingMetadata.current;
        pendingMetadata.current = null;
        metadataInFlight.current = captured;
        if (!(await flush())) {
          restoreInFlight();
          return false;
        }
        const ready = await watchReady.current;
        const id = watchId.current;
        // Read the revision only after screenshot flushing; content saves also advance project CAS.
        const revision = acceptedRevision.current;
        if (!ready || !id || !revision || pendingExternalChange.current) {
          restoreInFlight();
          setError(
            pendingExternalChange.current
              ? 'Project details are paused until you reload and review the workspace changes.'
              : 'Project details are waiting for the safe file watcher. Try saving again after it reconnects.',
          );
          return false;
        }
        try {
          const intended = metadataInFlight.current?.project ?? captured.project;
          const saved = workflowValue(
            await getRendererBridge().saveProjectCompareAndSwap({
              watchId: id,
              expectedRevision: revision,
              project: intended,
            }),
          );
          ownRevisionGeneration.current += 1;
          lastSavedSnapshot.current = saved.snapshot;
          publishAcceptedRevision(saved.projectRevision);
          const overlaid = overlayTrackedMetadata(saved.snapshot.project);
          metadataInFlight.current = null;
          if (overlaid.conflicts.length) {
            pendingMetadata.current ??= captured;
            metadataDirty.current = true;
            return false;
          }
          const displaySnapshot = { ...saved.snapshot, project: overlaid.project };
          snapshotRef.current = displaySnapshot;
          callbacks.current.onSnapshot(displaySnapshot);
        } catch (reason) {
          restoreInFlight();
          if (reason instanceof WorkflowRequestError && reason.workflowError.code === 'project-changed') {
            publishAcceptedRevision(null);
            publishExternalChange({
              kind: 'metadata-conflict',
              message:
                'Project details changed on disk. Your edits remain open; reload, compare, and save again.',
            });
          } else setError(workflowMessage(reason, 'Project details could not be saved.'));
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
  }, [flush, overlayTrackedMetadata, publishAcceptedRevision, publishExternalChange]);

  const saveProjectMetadata = useCallback(
    (project: ProjectData): Promise<boolean> => {
      queueProjectMetadata(project);
      return flushProjectMetadata();
    },
    [flushProjectMetadata, queueProjectMetadata],
  );

  const beginNativeMutation = useCallback((): number => {
    const token = ++nativeMutationGeneration.current;
    nativeMutationTokens.current.add(token);
    return token;
  }, []);

  const finishNativeMutation = useCallback(
    async (token: number | undefined, saveQueuedMetadata: boolean): Promise<boolean> => {
      if (token !== undefined) nativeMutationTokens.current.delete(token);
      if (nativeMutationTokens.current.size) return true;
      const saved =
        saveQueuedMetadata && pendingMetadata.current
          ? await flushProjectMetadata()
          : !pendingMetadata.current;
      const waiters = suspendedMetadataWaiters.current.splice(0);
      for (const resolve of waiters) resolve(saved);
      return saved;
    },
    [flushProjectMetadata],
  );

  const cancelNativeMutation = useCallback(
    (token: number): Promise<boolean> => finishNativeMutation(token, true),
    [finishNativeMutation],
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
        pendingMetadata.current = null;
        metadataInFlight.current = null;
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
        publishExternalChange(null);
        return true;
      } catch (reason) {
        setError(workflowMessage(reason, 'The project could not be reloaded.'));
        return false;
      }
    },
    [flush, hasDirtyDrafts, publishAcceptedRevision, publishExternalChange],
  );

  const adoptAuthoritativeSnapshot = useCallback(
    async (authoritativeSnapshot: ProjectSnapshot, nativeMutationToken?: number): Promise<boolean> => {
      if (
        nativeMutationTokens.current.size &&
        (nativeMutationToken === undefined || !nativeMutationTokens.current.has(nativeMutationToken))
      ) {
        setError('Wait for the current project operation to finish before reopening this project.');
        return false;
      }
      if (!(await flush())) {
        await finishNativeMutation(nativeMutationToken, false);
        return false;
      }

      const sameProject = snapshotRef.current?.projectPath === authoritativeSnapshot.projectPath;
      if (!sameProject && !(await finishNativeMutation(nativeMutationToken, true))) return false;
      if (nativeMutationToken === undefined && metadataDirty.current && !(await flushProjectMetadata()))
        return false;
      if (!sameProject && (pendingMetadata.current || metadataInFlight.current || hasDirtyDrafts())) {
        setError('The reopened project was not adopted because newer local edits are still waiting to save.');
        return false;
      }

      let next = authoritativeSnapshot;
      let revision = authoritativeSnapshot.projectRevision ?? null;
      // The open response predates the flush above. Even a revision-bearing response may
      // now be stale, so same-project adoption always starts from a fresh disk snapshot.
      if (sameProject) {
        const ready = await watchReady.current;
        const id = watchId.current;
        if (!ready || !id) {
          await finishNativeMutation(nativeMutationToken, false);
          setError('The reopened project could not establish a safe save revision. Try opening it again.');
          return false;
        }
        try {
          const latest = workflowValue(await getRendererBridge().reloadWatchedProject({ watchId: id }));
          next = {
            ...latest.snapshot,
            warnings: authoritativeSnapshot.warnings ?? latest.snapshot.warnings,
            recoveredDeletes: authoritativeSnapshot.recoveredDeletes ?? latest.snapshot.recoveredDeletes,
          };
          revision = latest.projectRevision;
        } catch (reason) {
          await finishNativeMutation(nativeMutationToken, false);
          setError(workflowMessage(reason, 'The reopened project could not be safely refreshed.'));
          return false;
        }
      }

      if (sameProject) {
        for (const [key, retained] of drafts.current) {
          if (retained.projectPath === next.projectPath && retained.editRevision === retained.savedRevision)
            drafts.current.delete(key);
        }
        setDraft(null);
      }
      lastSavedSnapshot.current = next;
      publishAcceptedRevision(sameProject ? revision : null);
      const overlaid = sameProject
        ? overlayTrackedMetadata(next.project)
        : { project: next.project, conflicts: [] };
      const displaySnapshot = { ...next, project: overlaid.project };
      snapshotRef.current = displaySnapshot;
      callbacks.current.onSnapshot(displaySnapshot);
      if (overlaid.conflicts.length) {
        await finishNativeMutation(nativeMutationToken, false);
        return false;
      }
      publishExternalChange(null);
      if (sameProject && !(await finishNativeMutation(nativeMutationToken, true))) return false;
      return !sameProject || revision !== null;
    },
    [
      finishNativeMutation,
      flush,
      flushProjectMetadata,
      hasDirtyDrafts,
      overlayTrackedMetadata,
      publishAcceptedRevision,
      publishExternalChange,
    ],
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
    queueProjectMetadata,
    flush,
    flushProjectMetadata,
    saveProjectMetadata,
    beginNativeMutation,
    cancelNativeMutation,
    async acceptMutationSnapshot(mutationSnapshot, selectScreenshotId, nativeMutationToken) {
      const mutatesCurrentProject = snapshotRef.current?.projectPath === mutationSnapshot.projectPath;
      if (!mutatesCurrentProject) {
        await finishNativeMutation(nativeMutationToken, false);
        snapshotRef.current = mutationSnapshot;
        lastSavedSnapshot.current = mutationSnapshot;
        callbacks.current.onSnapshot(mutationSnapshot);
        if (
          selectScreenshotId &&
          mutationSnapshot.project.screenshots.some((item) => item.id === selectScreenshotId)
        )
          callbacks.current.onSelectScreenshot(selectScreenshotId);
        return true;
      }
      if (!(await flush())) {
        await finishNativeMutation(nativeMutationToken, false);
        return false;
      }
      const ready = await watchReady.current;
      const id = watchId.current;
      if (!ready || !id) {
        await finishNativeMutation(nativeMutationToken, false);
        publishAcceptedRevision(null);
        publishExternalChange({
          kind: 'watch-error',
          message:
            'The project changed, but safe change monitoring is not ready. Your open edits were preserved; reconnect the workspace and reload before continuing.',
        });
        return false;
      }
      try {
        // Always reload after a native mutation. Its response can be older than edits saved while the
        // native request was in flight, whereas the watcher returns the latest authoritative snapshot.
        const latest = workflowValue(await getRendererBridge().reloadWatchedProject({ watchId: id }));
        ownRevisionGeneration.current += 1;
        lastSavedSnapshot.current = latest.snapshot;
        publishAcceptedRevision(latest.projectRevision);
        const overlaid = overlayTrackedMetadata(latest.snapshot.project);
        const acceptedSnapshot = {
          ...latest.snapshot,
          project: overlaid.project,
          warnings: (mutationSnapshot as ProjectSnapshot & RevisionBearingResult).warnings,
          recoveredDeletes: (
            mutationSnapshot as ProjectSnapshot & {
              recoveredDeletes?: Array<{ undoToken: string; screenshotId: string }>;
            }
          ).recoveredDeletes,
        };
        snapshotRef.current = acceptedSnapshot;
        callbacks.current.onSnapshot(acceptedSnapshot);
        if (overlaid.conflicts.length) {
          await finishNativeMutation(nativeMutationToken, false);
          return false;
        }
        if (!pendingExternalChange.current || pendingExternalChange.current.kind === 'metadata-conflict')
          publishExternalChange(null);
        if (!(await finishNativeMutation(nativeMutationToken, true))) return false;
        if (
          selectScreenshotId &&
          snapshotRef.current?.project.screenshots.some((item) => item.id === selectScreenshotId)
        )
          callbacks.current.onSelectScreenshot(selectScreenshotId);
        return acceptedRevision.current !== null && !pendingExternalChange.current;
      } catch (reason) {
        await finishNativeMutation(nativeMutationToken, false);
        publishAcceptedRevision(null);
        publishExternalChange({
          kind: 'watch-error',
          message: workflowMessage(
            reason,
            'The project changed, but its latest safe version could not be reloaded. Your open edits were preserved; reconnect the workspace before continuing.',
          ),
        });
        return false;
      }
    },
    adoptAuthoritativeSnapshot,
    async getSavedContext(requestedCollectionId) {
      await watchReady.current;
      if (pendingExternalChange.current || !acceptedRevision.current)
        throw new Error('Reload and review the pending workspace change before preparing prompt bundles.');
      if (!(await flush())) throw new Error('Current screenshot edits could not be saved.');
      if (metadataDirty.current && !(await flushProjectMetadata()))
        throw new Error('Project details could not be saved. Prompt preparation was cancelled.');
      if (pendingExternalChange.current || !acceptedRevision.current)
        throw new Error(
          'The workspace changed while prompt bundles were being prepared. Reload and review it, then try again.',
        );
      const saved = lastSavedSnapshot.current;
      if (!saved) throw new Error('Open a project before preparing prompt bundles.');
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
