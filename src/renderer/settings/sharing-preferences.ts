import { useCallback, useEffect, useRef, useState } from 'react';
import { sharingSenderNameSchema } from '../../shared/schema';
import type { WorkspaceSettings } from '../../shared/types';
import { useAppStore } from '../store';

let settingsWriteQueue: Promise<void> = Promise.resolve();

export function normalizeSharingSenderName(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFC').trim() : '';
}

export function validateSharingSenderName(
  value: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const parsed = sharingSenderNameSchema.safeParse(value);
  if (!parsed.success) {
    const tooLong = [...normalizeSharingSenderName(value)].length > 80;
    return {
      ok: false,
      error: tooLong
        ? 'Keep the sender name to 80 characters or fewer.'
        : 'Use a plain sender name without control or formatting characters.',
    };
  }
  return { ok: true, value: parsed.data };
}

/** Serializes settings writes so a slower earlier response cannot replace a newer preference. */
export function saveWorkspaceSettingsPatch(patch: Partial<WorkspaceSettings>): Promise<WorkspaceSettings> {
  const operation = settingsWriteQueue.catch(() => undefined).then(() => window.imnota.setSettings(patch));
  settingsWriteQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

export interface SharingSenderNameState {
  senderName: string;
  setSenderName(value: string): void;
  saveSenderName(): Promise<boolean>;
  saving: boolean;
  error: string;
}

export function useSharingSenderName(): SharingSenderNameState {
  const storedName = useAppStore((state) => normalizeSharingSenderName(state.settings.sharingSenderName));
  const [senderName, setSenderNameState] = useState(storedName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const draft = useRef(storedName);
  const persisted = useRef(storedName);
  const dirty = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const pending = useRef<{ value: string; promise: Promise<boolean> } | undefined>(undefined);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    persisted.current = storedName;
    if (!dirty.current) {
      draft.current = storedName;
      setSenderNameState(storedName);
    }
  }, [storedName]);

  const setSenderName = useCallback((value: string) => {
    draft.current = value;
    dirty.current = true;
    setSenderNameState(value);
    setError('');
  }, []);

  const saveSenderName = useCallback((): Promise<boolean> => {
    const requested = draft.current;
    const validation = validateSharingSenderName(requested);
    if (!validation.ok) {
      setError(validation.error);
      return Promise.resolve(false);
    }
    const normalized = validation.value;
    if (pending.current?.value === normalized) return pending.current.promise;
    if (normalized === persisted.current && !pending.current) {
      dirty.current = false;
      draft.current = normalized;
      setSenderNameState(normalized);
      setError('');
      return Promise.resolve(true);
    }

    const requestGeneration = ++generation.current;
    setSaving(true);
    setError('');
    const operation = saveWorkspaceSettingsPatch({ sharingSenderName: normalized || undefined })
      .then((nextSettings) => {
        persisted.current = normalizeSharingSenderName(nextSettings.sharingSenderName);
        useAppStore.getState().set({ settings: nextSettings });
        if (mounted.current && draft.current === requested) {
          dirty.current = false;
          draft.current = normalized;
          setSenderNameState(normalized);
        }
        return true;
      })
      .catch(() => {
        if (mounted.current && requestGeneration === generation.current)
          setError('The sender name could not be saved. Your previous name is still active.');
        return false;
      })
      .finally(() => {
        if (pending.current?.promise === operation) pending.current = undefined;
        if (mounted.current && requestGeneration === generation.current) setSaving(false);
      });
    pending.current = { value: normalized, promise: operation };
    return operation;
  }, []);

  return { senderName, setSenderName, saveSenderName, saving, error };
}
