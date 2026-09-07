import {
  Archive,
  Check,
  ChevronDown,
  Clipboard,
  Eye,
  EyeOff,
  FileImage,
  PanelLeft,
  Pencil,
  Plus,
  Upload,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ProjectData, ProjectSnapshot, ScreenshotRecord } from '../../shared/types';
import { nowIso } from '../../shared/utils';
import { Button, IconButton, Modal, TextArea, TextInput } from '../components/ui';
import { useAppStore } from '../store';

export interface CollectionRailProps {
  onFlush(): Promise<boolean>;
  onSaveProject(project: ProjectData): Promise<boolean>;
  onUpdateProject(project: ProjectData): void;
  onSelectScreenshot(id: string): void | Promise<void>;
  onSelectCollection(id: string): void | Promise<void>;
  onImport(): void;
  onPaste(): void | Promise<void>;
  onMessage(message: string): void;
  onSnapshot(snapshot: ProjectSnapshot, selectScreenshotId?: string): void | Promise<void>;
}

export function CollectionControls({
  onFlush,
  onSelectCollection,
  onSnapshot,
  onSaveProject,
  onUpdateProject,
}: {
  onFlush(): Promise<boolean | void>;
  onSelectCollection?(id: string): void | Promise<void>;
  onSnapshot?(snapshot: ProjectSnapshot, selectScreenshotId?: string): void | Promise<void>;
  onSaveProject?(project: ProjectData): Promise<boolean>;
  onUpdateProject?(project: ProjectData): void;
}) {
  const store = useAppStore();
  const project = store.snapshot?.project;
  const current = project?.collections.find((collection) => collection.id === store.activeCollectionId);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(current?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  const pickerMenuRef = useRef<HTMLDivElement>(null);
  const pickerOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pickerId = useId().replace(/:/g, '');
  const collections = project?.collections ?? [];
  const selectedIndex = Math.max(
    0,
    collections.findIndex((collection) => collection.id === current?.id),
  );

  useEffect(() => setName(current?.name ?? ''), [current?.id, current?.name]);
  useEffect(() => {
    if (!pickerOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
    };
  }, [pickerOpen]);
  useEffect(() => {
    if (!pickerOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const option = pickerOptionRefs.current[focusedIndex];
      const menu = pickerMenuRef.current;
      if (!option || !menu) return;
      const top = option.offsetTop;
      const bottom = top + option.offsetHeight;
      if (top < menu.scrollTop) menu.scrollTop = top;
      else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
      option.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedIndex, pickerOpen]);
  if (!project || !current || !store.snapshot) return null;

  const closePicker = (restoreFocus = false) => {
    setPickerOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => pickerTriggerRef.current?.focus());
  };
  const openPicker = (index = selectedIndex) => {
    setFocusedIndex(Math.min(Math.max(index, 0), collections.length - 1));
    setPickerOpen(true);
  };
  const chooseCollection = (collectionId: string) => {
    closePicker(true);
    void (onSelectCollection ?? ((id) => store.setActiveCollection(id)))(collectionId);
  };
  const moveFocus = (nextIndex: number) => {
    setFocusedIndex(Math.min(Math.max(nextIndex, 0), collections.length - 1));
  };

  async function apply(action: 'create' | 'rename' | 'archive' | 'restore') {
    if (busy || (action === 'rename' && !name.trim()) || (await onFlush()) === false) return;
    setBusy(true);
    setError('');
    try {
      const snapshot = await window.imnota.editCollection({
        projectPath: store.snapshot!.projectPath,
        collectionId: current!.id,
        action,
        name: action === 'rename' ? name : undefined,
      });
      const createdId = action === 'create' ? snapshot.project.collections.at(-1)?.id : undefined;
      await (onSnapshot ?? ((next) => store.setProject(next)))(
        snapshot,
        createdId ? undefined : (store.activeScreenshotId ?? undefined),
      );
      if (createdId) await (onSelectCollection ?? ((id) => store.setActiveCollection(id)))(createdId);
      setRenaming(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The collection could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  const updateOverallContext = (value: string) => {
    const next = {
      ...project,
      updatedAt: nowIso(),
      collections: project.collections.map((collection) =>
        collection.id === current.id
          ? { ...collection, overallContext: value, updatedAt: nowIso() }
          : collection,
      ),
    };
    (onUpdateProject ?? store.updateProject)(next);
  };

  return (
    <div className="round-controls">
      <div className="collection-control-heading">
        <span className="field-label">Collection</span>
        <IconButton
          data-testid="new-collection"
          className="new-collection-button"
          label="New collection"
          disabled={busy}
          onClick={() => void apply('create')}
        >
          <Plus size={14} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="collection-picker" ref={pickerRef}>
        <button
          ref={pickerTriggerRef}
          type="button"
          className="collection-picker-trigger"
          aria-label="Collection"
          aria-haspopup="listbox"
          aria-expanded={pickerOpen}
          aria-controls={pickerId}
          data-testid="collection-picker"
          onClick={() => (pickerOpen ? closePicker() : openPicker())}
          onKeyDown={(event) => {
            if (
              event.key === 'ArrowDown' ||
              event.key === 'ArrowUp' ||
              event.key === 'Home' ||
              event.key === 'End'
            ) {
              event.preventDefault();
              openPicker(selectedIndex);
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              if (pickerOpen) closePicker();
              else openPicker();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              closePicker(true);
            }
          }}
        >
          <span>{current.name}</span>
          {current.archived && <small>Archived</small>}
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <div className="collection-picker-actions">
          <IconButton label="Rename" disabled={busy} onClick={() => setRenaming(true)}>
            <Pencil size={14} aria-hidden="true" />
          </IconButton>
          <IconButton
            label={current.archived ? 'Restore' : 'Archive'}
            disabled={busy}
            onClick={() => void apply(current.archived ? 'restore' : 'archive')}
          >
            <Archive size={14} aria-hidden="true" />
          </IconButton>
        </div>
        {pickerOpen && (
          <div
            ref={pickerMenuRef}
            id={pickerId}
            className="collection-picker-menu"
            role="listbox"
            aria-label="Collections"
          >
            {collections.map((collection, index) => (
              <button
                ref={(element) => {
                  pickerOptionRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={collection.id === current.id}
                tabIndex={index === focusedIndex ? 0 : -1}
                className="collection-picker-option"
                key={collection.id}
                onClick={() => chooseCollection(collection.id)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    moveFocus(index + 1);
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    moveFocus(index - 1);
                  } else if (event.key === 'Home') {
                    event.preventDefault();
                    moveFocus(0);
                  } else if (event.key === 'End') {
                    event.preventDefault();
                    moveFocus(collections.length - 1);
                  } else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    chooseCollection(collection.id);
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    closePicker(true);
                  }
                }}
              >
                <span>{collection.name}</span>
                {collection.archived && <small>Archived</small>}
                {collection.id === current.id && (
                  <Check className="collection-picker-check" size={13} aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <details className="collection-context">
        <summary>Overall context{current.overallContext.trim() ? ' · Added' : ''}</summary>
        <TextArea
          aria-label="Overall context"
          rows={4}
          placeholder="Context shared by every screenshot in this collection"
          value={current.overallContext}
          onChange={(event) => updateOverallContext(event.target.value)}
          onBlur={() => {
            if (onUpdateProject) return;
            const latest = useAppStore.getState().snapshot?.project;
            if (latest)
              void (
                onSaveProject
                  ? onSaveProject(latest)
                  : window.imnota.saveProject(store.snapshot!.projectPath, latest).then(() => true)
              ).then((saved) => !saved && setError('Overall context could not be saved.'));
          }}
        />
      </details>
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
      {renaming && (
        <Modal
          title="Rename collection"
          description="Screenshot files and the internal collection ID stay unchanged."
          onClose={() => !busy && setRenaming(false)}
        >
          <form
            className="modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              void apply('rename');
            }}
          >
            <TextInput
              data-autofocus
              label="Collection name"
              disabled={busy}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="modal-actions">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setRenaming(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" busy={busy} disabled={!name.trim()}>
                Rename collection
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function CollectionRail({
  onFlush,
  onSaveProject,
  onUpdateProject,
  onSelectScreenshot,
  onSelectCollection,
  onImport,
  onPaste,
  onMessage,
  onSnapshot,
}: CollectionRailProps) {
  const store = useAppStore();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const project = store.snapshot?.project;
  const shots =
    project?.screenshots
      .filter((shot) => shot.collectionId === store.activeCollectionId)
      .sort((left, right) => left.position - right.position) ?? [];
  const collection = project?.collections.find((item) => item.id === store.activeCollectionId);

  async function reorderScreenshot(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex || !project) return;
    const ordered = [...shots];
    const [moved] = ordered.splice(dragIndex, 1);
    if (!moved) return;
    ordered.splice(targetIndex, 0, moved);
    const positions = new Map(ordered.map((item, position) => [item.id, position]));
    const next = {
      ...project,
      updatedAt: nowIso(),
      screenshots: project.screenshots.map((item) => ({
        ...item,
        position: positions.get(item.id) ?? item.position,
      })),
    };
    store.updateProject(next);
    setDragIndex(null);
    if (!(await onSaveProject(next)))
      onMessage('The new screenshot order remains open but has not been saved.');
  }

  async function toggleVisibility(screenshot: ScreenshotRecord) {
    if (!project) return;
    const next = {
      ...project,
      updatedAt: nowIso(),
      screenshots: project.screenshots.map((item) =>
        item.id === screenshot.id ? { ...item, includeInExport: !item.includeInExport } : item,
      ),
    };
    store.updateProject(next);
    if (!(await onSaveProject(next)))
      onMessage('The include/exclude change remains open but has not been saved.');
  }

  return (
    <aside
      className={`shot-rail ${store.leftPanelOpen ? '' : 'collapsed'}`}
      aria-label="Collections and screenshots"
      data-testid="collection-rail"
    >
      <div className="rail-heading">
        {store.leftPanelOpen && <strong>{project?.name}</strong>}
        <IconButton
          label={store.leftPanelOpen ? 'Collapse collections panel' : 'Expand collections panel'}
          onClick={() => store.set({ leftPanelOpen: !store.leftPanelOpen })}
        >
          <PanelLeft size={17} aria-hidden="true" />
        </IconButton>
      </div>
      {store.leftPanelOpen && (
        <>
          <CollectionControls
            onFlush={onFlush}
            onSaveProject={onSaveProject}
            onUpdateProject={onUpdateProject}
            onSelectCollection={onSelectCollection}
            onSnapshot={onSnapshot}
          />
          <div className="shot-list" aria-label="Screenshot sequence">
            {shots.map((item, index) => (
              <div
                key={item.id}
                draggable
                className={`shot-item ${item.id === store.activeScreenshotId ? 'active' : ''} ${item.includeInExport ? '' : 'excluded'}`}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.stopPropagation();
                  void reorderScreenshot(index);
                }}
              >
                <button
                  className="shot-select"
                  onClick={() => void onSelectScreenshot(item.id)}
                  data-testid={`screenshot-${item.id}`}
                >
                  <span className="shot-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="thumb">
                    {store.snapshot?.thumbnails[item.id] ? (
                      <img src={store.snapshot.thumbnails[item.id]} alt="" />
                    ) : (
                      <FileImage size={18} aria-hidden="true" />
                    )}
                  </div>
                  <span className="shot-copy">
                    <strong>{item.title || item.originalFilename}</strong>
                    <small>
                      {item.conflict
                        ? item.includeInExport
                          ? 'Copy conflict · included manually · '
                          : 'Copy conflict · excluded · '
                        : ''}
                      {item.priority} priority
                    </small>
                  </span>
                </button>
                <IconButton
                  data-testid={`screenshot-export-toggle-${item.id}`}
                  className="shot-visibility"
                  label={
                    item.includeInExport
                      ? `Exclude ${item.title} from prompt`
                      : `Include ${item.title} in prompt`
                  }
                  onClick={() => void toggleVisibility(item)}
                >
                  {item.includeInExport ? (
                    <Eye size={16} aria-hidden="true" />
                  ) : (
                    <EyeOff size={16} aria-hidden="true" />
                  )}
                </IconButton>
              </div>
            ))}
          </div>
          <div className="rail-actions">
            <Button variant="soft" disabled={collection?.archived} onClick={onImport}>
              <Upload size={15} aria-hidden="true" />
              Add screenshots
            </Button>
            <Button variant="ghost" disabled={collection?.archived} onClick={() => void onPaste()}>
              <Clipboard size={15} aria-hidden="true" />
              Paste from clipboard
            </Button>
          </div>
        </>
      )}
    </aside>
  );
}
