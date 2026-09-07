import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentItemContent, SaveContentItemResult } from '../../shared/content-items';
import type { ProjectSnapshot } from '../../shared/types';

interface Draft {
  projectPath: string;
  content: ContentItemContent;
  version: number;
  savedVersion: number;
  pendingAdoption?: { saved: SaveContentItemResult; version: number };
}

interface Options {
  snapshot: ProjectSnapshot | null;
  itemId: string | null;
  beforeSave(): Promise<boolean>;
  beginMutation(): number;
  acceptSnapshot(snapshot: ProjectSnapshot, itemId: string, token: number): Promise<boolean>;
  cancelMutation(token: number): Promise<boolean>;
}

/** Retain newer edits while PNG rendering and the native transaction are in flight. */
export function useContentPersistence(options: Options) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const draft = useRef<Draft | null>(null);
  const operation = useRef<Promise<boolean> | null>(null);
  const [content, setContent] = useState<ContentItemContent | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const projectPath = options.snapshot?.projectPath;
  const item = options.snapshot?.project.contentItems?.find((entry) => entry.id === options.itemId);

  useEffect(() => {
    let cancelled = false;
    // Navigation normally flushes first. Keep edits through conflict identity handoffs too.
    if (
      draft.current &&
      (draft.current.pendingAdoption || draft.current.version !== draft.current.savedVersion)
    )
      return;
    if (!projectPath || !item) {
      draft.current = null;
      setContent(null);
      setLoading(false);
      return;
    }
    // An authoritative snapshot after our own save must not overwrite newer typing.
    if (
      draft.current?.projectPath === projectPath &&
      draft.current.content.item.id === item.id &&
      (draft.current.version !== draft.current.savedVersion ||
        draft.current.content.item.updatedAt === item.updatedAt)
    )
      return;
    draft.current = null;
    setContent(null);
    setError('');
    setLoading(true);
    void window.imnota
      .loadContentItem({ projectPath, itemId: item.id })
      .then((loaded) => {
        if (cancelled) return;
        draft.current = { projectPath, content: loaded, version: 0, savedVersion: 0 };
        setContent(loaded);
        setSaveState('saved');
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Content could not be loaded.');
          setSaveState('error');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, item, reloadGeneration]);

  const change = useCallback((patch: { markdown?: string; source?: string }) => {
    const current = draft.current;
    if (!current) return;
    if (
      Object.entries(patch).every(([key, value]) => current.content[key as 'markdown' | 'source'] === value)
    )
      return;
    current.content = { ...current.content, ...patch };
    current.version += 1;
    setContent(current.content);
    setSaveState('saving');
    setGeneration((value) => value + 1);
  }, []);

  const flush = useCallback((): Promise<boolean> => {
    if (operation.current) return operation.current;
    operation.current = (async () => {
      while (
        draft.current &&
        (draft.current.pendingAdoption || draft.current.version !== draft.current.savedVersion)
      ) {
        const current = draft.current;
        const version = current.version;
        const captured = { ...current.content };
        let token: number | undefined;
        try {
          if (current.pendingAdoption) {
            const pending = current.pendingAdoption;
            token = callbacks.current.beginMutation();
            if (
              !(await callbacks.current.acceptSnapshot(pending.saved.snapshot, pending.saved.itemId, token))
            )
              throw new Error(
                'Content was saved, but the project still needs to be reloaded. Retry to reconnect.',
              );
            token = undefined;
            current.savedVersion = pending.version;
            current.pendingAdoption = undefined;
            if (draft.current === current) setContent(current.content);
            setError('');
            continue;
          }
          if (!(await callbacks.current.beforeSave()))
            throw new Error('Save the pending project changes before saving this item.');
          setSaveState('saving');
          const image =
            captured.item.kind === 'drawing'
              ? await (await import('./drawing-render')).renderDrawing(captured.source ?? '')
              : undefined;
          if (image && captured.item.kind === 'drawing') image.filename = captured.item.imageFilename;
          token = callbacks.current.beginMutation();
          const saved = await window.imnota.saveContentItem({
            projectPath: current.projectPath,
            itemId: captured.item.id,
            contentRevision: captured.contentRevision,
            markdown: captured.markdown,
            source: captured.source,
            image,
          });
          const savedItem = saved.snapshot.project.contentItems?.find((entry) => entry.id === saved.itemId);
          if (!savedItem)
            throw new Error('The saved item was missing from the project response. Your edits remain open.');
          // A conflict copy owns subsequent edits; never overwrite the external source.
          current.content = {
            ...current.content,
            item: savedItem,
            contentRevision: saved.contentRevision,
            image,
          };
          current.pendingAdoption = { saved, version };
          if (!(await callbacks.current.acceptSnapshot(saved.snapshot, saved.itemId, token)))
            throw new Error(
              'Content was saved, but the latest project could not be adopted. Reload to review it.',
            );
          token = undefined;
          current.savedVersion = version;
          current.pendingAdoption = undefined;
          if (draft.current === current) setContent(current.content);
          setError(
            saved.conflictCreated
              ? 'External edits were preserved. Your changes were saved as an excluded conflict copy.'
              : '',
          );
        } catch (reason) {
          if (token !== undefined) await callbacks.current.cancelMutation(token);
          setSaveState('error');
          setError(reason instanceof Error ? reason.message : 'Content could not be saved.');
          return false;
        }
      }
      setSaveState('saved');
      return true;
    })().finally(() => {
      operation.current = null;
    });
    return operation.current;
  }, []);

  useEffect(() => {
    if (!generation) return;
    const timer = window.setTimeout(() => {
      void flush();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [generation, flush]);

  return {
    content,
    loading,
    saveState,
    error,
    change,
    flush,
    hasUnsavedChanges: Boolean(
      draft.current &&
      (draft.current.pendingAdoption || draft.current.version !== draft.current.savedVersion),
    ),
    retry() {
      if (draft.current) void flush();
      else setReloadGeneration((value) => value + 1);
    },
    reset() {
      draft.current = null;
      setContent(null);
      setGeneration(0);
      setReloadGeneration((value) => value + 1);
    },
  };
}
