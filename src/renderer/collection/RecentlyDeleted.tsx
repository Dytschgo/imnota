import { FileImage, FileText, History, Pencil } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DELETED_ITEM_RETENTION_DAYS,
  type RecentlyDeletedItem,
  type RecentlyDeletedRestoreResult,
} from '../../shared/recently-deleted';
import type { Collection } from '../../shared/types';
import { Button, Modal } from '../components/ui';
import { collectionDisplayName } from './collection-display-name';

const KIND = {
  screenshot: { label: 'Screenshot', icon: FileImage },
  drawing: { label: 'Drawing', icon: Pencil },
  text: { label: 'Text block', icon: FileText },
} as const;

export interface RecentlyDeletedProps {
  projectPath: string;
  collections: readonly Collection[];
  /**
   * Runs the same restore as the Undo toast. Resolves with a message when the item was not
   * restored, so the reason is shown in this dialog instead of behind it.
   */
  onRestore(item: RecentlyDeletedItem): Promise<RecentlyDeletedRestoreResult>;
}

function deletedTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'at an unknown time' : date.toLocaleString();
}

/** Rail entry point and dialog for restoring items whose delete journal is still kept. */
export function RecentlyDeleted({ projectPath, collections, onRestore }: RecentlyDeletedProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        className="recently-deleted-open"
        data-testid="recently-deleted-open"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <History size={15} aria-hidden="true" />
        Recently deleted
      </Button>
      {open && (
        <RecentlyDeletedDialog
          projectPath={projectPath}
          collections={collections}
          onRestore={onRestore}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function RecentlyDeletedDialog({
  projectPath,
  collections,
  onRestore,
  onClose,
}: RecentlyDeletedProps & { onClose(): void }) {
  const [items, setItems] = useState<RecentlyDeletedItem[] | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [restoring, setRestoring] = useState<string | null>(null);
  /** Where focus goes once a restore settles: the retried row, or the status line when it is gone. */
  const [focusRequest, setFocusRequest] = useState<{ undoToken: string | null } | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const restoreButtons = useRef(new Map<string, HTMLButtonElement>());
  const mounted = useRef(true);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setError('');
    try {
      const next = await window.imnota.listRecentlyDeleted(projectPath);
      if (!mounted.current || generation !== loadGeneration.current) return;
      setItems(next);
    } catch (reason) {
      if (!mounted.current || generation !== loadGeneration.current) return;
      setItems([]);
      setError(reason instanceof Error ? reason.message : 'Recently deleted items could not be listed.');
    }
  }, [projectPath]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (!focusRequest) return;
    const button = focusRequest.undoToken ? restoreButtons.current.get(focusRequest.undoToken) : undefined;
    (button ?? statusRef.current)?.focus();
  }, [focusRequest]);

  async function restore(item: RecentlyDeletedItem) {
    if (restoring) return;
    setRestoring(item.undoToken);
    setError('');
    setStatus('');
    let outcome: RecentlyDeletedRestoreResult;
    try {
      outcome = await onRestore(item);
    } catch (reason) {
      outcome = reason instanceof Error ? reason.message : 'The item could not be restored.';
    }
    if (!mounted.current) return;
    // The journal is the source of truth for what can still be restored.
    await load();
    if (!mounted.current) return;
    setRestoring(null);
    const failure = typeof outcome === 'string' ? outcome : null;
    const warning = outcome && typeof outcome === 'object' ? outcome.warning : '';
    if (failure) setError(`Restore could not be completed for “${item.title}”. ${failure}`);
    else setStatus([`Restored “${item.title}”.`, warning].filter(Boolean).join(' '));
    setFocusRequest({ undoToken: failure ? item.undoToken : null });
  }

  const collectionNames = collections.map((collection) => collection.name);
  const collectionName = (id: string) => {
    const collection = collections.find((entry) => entry.id === id);
    return collection
      ? collectionDisplayName(
          collection.name,
          projectPath,
          collectionNames.filter((name) => name !== collection.name),
        )
      : null;
  };

  return (
    <Modal
      title="Recently deleted"
      description={`Deleted screenshots, drawings and text blocks are kept for ${DELETED_ITEM_RETENTION_DAYS} days. After that, opening the project permanently removes eligible recovery copies. Restore puts an item back in its collection.`}
      onClose={onClose}
    >
      <div className="recently-deleted" data-testid="recently-deleted-dialog">
        <p ref={statusRef} tabIndex={-1} role="status" className="recently-deleted-status">
          {items === null ? 'Loading deleted items…' : status}
        </p>
        {error && (
          <div>
            <p className="modal-error" role="alert">
              {error}
            </p>
            <Button disabled={restoring !== null} onClick={() => void load()}>
              Refresh list
            </Button>
          </div>
        )}
        {items !== null && items.length === 0 && !error && (
          <p className="recently-deleted-empty">
            Nothing deleted from this project in the last {DELETED_ITEM_RETENTION_DAYS} days can be restored.
          </p>
        )}
        {items !== null && items.length > 0 && (
          <ul className="recently-deleted-list" aria-label="Deleted items">
            {items.map((item) => {
              const kind = KIND[item.kind];
              const Icon = kind.icon;
              const collection = collectionName(item.collectionId);
              return (
                <li key={item.undoToken} data-testid={`recently-deleted-${item.itemId}`}>
                  <span className="recently-deleted-icon">
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="recently-deleted-copy">
                    <strong title={item.title}>{item.title}</strong>
                    <small>
                      {kind.label}
                      {collection ? ` · ${collection}` : ''} · Deleted{' '}
                      <time dateTime={item.deletedAt}>{deletedTime(item.deletedAt)}</time>
                    </small>
                  </span>
                  <Button
                    ref={(element) => {
                      if (element) restoreButtons.current.set(item.undoToken, element);
                      else restoreButtons.current.delete(item.undoToken);
                    }}
                    variant="soft"
                    aria-label={`Restore ${kind.label.toLowerCase()}: ${item.title}`}
                    busy={restoring === item.undoToken}
                    disabled={restoring !== null}
                    onClick={() => void restore(item)}
                  >
                    Restore
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
