import {
  Archive,
  ArchiveRestore,
  Camera,
  Check,
  ChevronDown,
  Clipboard,
  Eye,
  EyeOff,
  FileImage,
  FileText,
  PanelLeft,
  Timer,
  Trash2,
  Pencil,
  Plus,
  Upload,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { CaptureDelaySeconds } from '../../shared/capture';
import type { ProjectData, ProjectSnapshot } from '../../shared/types';
import { orderedCollectionItems } from '../../shared/content-items';
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
  onAddContent?(kind: 'drawing' | 'text'): void | Promise<void>;
  onDeleteItem?(id: string, kind: 'screenshot' | 'drawing' | 'text'): void | Promise<void>;
  /** Default true: Add screenshot is primary. False restores the combined Add item menu. */
  screenshotFirstAdd?: boolean;
  /** Same capture entry point as the toolbar camera; shares its enablement and platform limits. */
  onCapture?(delaySeconds?: CaptureDelaySeconds): void;
  /** Windows makes capture the primary screenshot action; other platforms keep import primary. */
  capturePrimary?: boolean;
  captureEnabled?: boolean;
  captureInProgress?: boolean;
  captureDisabledLabel?: string;
}

/** Filled when archived, outlined while active. Rows name their state through the option instead. */
function CollectionStatus({ archived, decorative = false }: { archived: boolean; decorative?: boolean }) {
  const label = archived ? 'Status: archived' : 'Status: active';
  return (
    <Archive
      className={`collection-status ${archived ? 'collection-status-archived' : ''}`}
      size={12}
      fill={archived ? 'currentColor' : 'none'}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={decorative ? undefined : label}
    >
      <title>{label}</title>
    </Archive>
  );
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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const operationPending = useRef(false);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusedItemIndex, setFocusedItemIndex] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  const pickerMenuRef = useRef<HTMLDivElement>(null);
  const pickerItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const restorePickerFocusAfterRename = useRef(false);
  const pickerId = useId().replace(/:/g, '');
  const collections = project?.collections ?? [];
  const selectedIndex = Math.max(
    0,
    collections.findIndex((collection) => collection.id === current?.id),
  );

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
      const item = pickerItemRefs.current[focusedItemIndex];
      const menu = pickerMenuRef.current;
      if (!item || !menu) return;
      if (item.disabled) {
        setFocusedItemIndex(Math.floor(focusedItemIndex / 3) * 3);
        return;
      }
      const top = item.offsetTop;
      const bottom = top + item.offsetHeight;
      if (top < menu.scrollTop) menu.scrollTop = top;
      else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
      item.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [busy, focusedItemIndex, pickerOpen]);
  if (!project || !current || !store.snapshot) return null;

  const closePicker = (restoreFocus = false) => {
    setPickerOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => pickerTriggerRef.current?.focus());
  };
  const openPicker = (collectionIndex = selectedIndex) => {
    setFocusedItemIndex(Math.min(Math.max(collectionIndex, 0), collections.length - 1) * 3);
    setPickerOpen(true);
  };
  const chooseCollection = (collectionId: string) => {
    closePicker(true);
    void (onSelectCollection ?? ((id) => store.setActiveCollection(id)))(collectionId);
  };
  const movePickerFocus = (nextIndex: number, direction = 0) => {
    const lastItemIndex = collections.length * 3 - 1;
    let candidate = Math.min(Math.max(nextIndex, 0), lastItemIndex);
    while (busy && candidate % 3 !== 0) {
      if (direction > 0 && candidate < lastItemIndex) candidate += 1;
      else if (direction < 0 && candidate > 0) candidate -= 1;
      else candidate -= candidate % 3;
    }
    setFocusedItemIndex(candidate);
  };
  const handlePickerItemKeyDown = (event: KeyboardEvent<HTMLButtonElement>, itemIndex: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      movePickerFocus(itemIndex + 1, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      movePickerFocus(itemIndex - 1, -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      movePickerFocus(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      movePickerFocus(collections.length * 3 - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closePicker(true);
    }
  };

  const renaming = renamingId ? collections.find((collection) => collection.id === renamingId) : undefined;
  const beginRename = (collection: (typeof collections)[number]) => {
    closePicker();
    restorePickerFocusAfterRename.current = true;
    setName(collection.name);
    setRenamingId(collection.id);
  };
  const closeRename = () => {
    setRenamingId(null);
    if (restorePickerFocusAfterRename.current) {
      restorePickerFocusAfterRename.current = false;
      window.requestAnimationFrame(() => pickerTriggerRef.current?.focus());
    }
  };

  async function apply(action: 'create' | 'rename' | 'archive' | 'restore', collectionId = current!.id) {
    if (operationPending.current || (action === 'rename' && !name.trim())) return;
    operationPending.current = true;
    setBusy(true);
    setError('');
    try {
      if ((await onFlush()) === false) return;
      const snapshot = await window.imnota.editCollection({
        projectPath: store.snapshot!.projectPath,
        collectionId,
        action,
        name: action === 'rename' ? name : undefined,
      });
      const createdId = action === 'create' ? snapshot.project.collections.at(-1)?.id : undefined;
      await (onSnapshot ?? ((next) => store.setProject(next)))(
        snapshot,
        createdId ? undefined : (store.activeScreenshotId ?? undefined),
      );
      if (createdId) await (onSelectCollection ?? ((id) => store.setActiveCollection(id)))(createdId);
      if (action === 'rename') closeRename();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The collection could not be saved.');
    } finally {
      operationPending.current = false;
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
          aria-haspopup="menu"
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
              openPicker(event.key === 'Home' || event.key === 'ArrowDown' ? 0 : collections.length - 1);
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
          <CollectionStatus archived={current.archived} />
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {pickerOpen && (
          <div
            ref={pickerMenuRef}
            id={pickerId}
            className="collection-picker-menu"
            role="menu"
            aria-label="Collections"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) closePicker();
            }}
          >
            {collections.map((collection, index) => {
              const optionIndex = index * 3;
              return (
                <div className="collection-picker-row" key={collection.id}>
                  <button
                    ref={(element) => {
                      pickerItemRefs.current[optionIndex] = element;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={collection.id === current.id}
                    aria-label={collection.name}
                    aria-description={collection.archived ? 'Archived' : 'Active'}
                    tabIndex={optionIndex === focusedItemIndex ? 0 : -1}
                    className="collection-picker-option"
                    onClick={() => chooseCollection(collection.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        chooseCollection(collection.id);
                      } else handlePickerItemKeyDown(event, optionIndex);
                    }}
                  >
                    <span>{collection.name}</span>
                    <CollectionStatus archived={collection.archived} decorative />
                    {collection.id === current.id && (
                      <Check className="collection-picker-check" size={13} aria-hidden="true" />
                    )}
                  </button>
                  <IconButton
                    ref={(element) => {
                      pickerItemRefs.current[optionIndex + 1] = element;
                    }}
                    role="menuitem"
                    tabIndex={optionIndex + 1 === focusedItemIndex ? 0 : -1}
                    label={`Rename ${collection.name}`}
                    disabled={busy}
                    onClick={() => beginRename(collection)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        beginRename(collection);
                      } else handlePickerItemKeyDown(event, optionIndex + 1);
                    }}
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    ref={(element) => {
                      pickerItemRefs.current[optionIndex + 2] = element;
                    }}
                    role="menuitem"
                    tabIndex={optionIndex + 2 === focusedItemIndex ? 0 : -1}
                    label={`${collection.archived ? 'Restore' : 'Archive'} ${collection.name}`}
                    disabled={busy}
                    onClick={() => void apply(collection.archived ? 'restore' : 'archive', collection.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        void apply(collection.archived ? 'restore' : 'archive', collection.id);
                      } else handlePickerItemKeyDown(event, optionIndex + 2);
                    }}
                  >
                    {collection.archived ? (
                      <ArchiveRestore size={13} aria-hidden="true" />
                    ) : (
                      <Archive size={13} aria-hidden="true" />
                    )}
                  </IconButton>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <details className="collection-context">
        <summary>Bundle context{current.overallContext.trim() ? ' · Added' : ''}</summary>
        <TextArea
          aria-label="Overall context"
          rows={4}
          placeholder="What should the agent understand about this collection?"
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
          onClose={() => !busy && closeRename()}
        >
          <form
            className="modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              void apply('rename', renaming.id);
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
              <Button type="button" variant="ghost" disabled={busy} onClick={closeRename}>
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
  onAddContent,
  onDeleteItem,
  screenshotFirstAdd = true,
  onCapture,
  capturePrimary = false,
  captureEnabled = false,
  captureInProgress = false,
  captureDisabledLabel,
}: CollectionRailProps) {
  const store = useAppStore();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMenuFocusedIndex, setAddMenuFocusedIndex] = useState(0);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const addMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const addMenuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const addMenuId = useId().replace(/:/g, '');
  const project = store.snapshot?.project;
  const shots = project ? orderedCollectionItems(project, store.activeCollectionId) : [];
  const collection = project?.collections.find((item) => item.id === store.activeCollectionId);
  const captureIsPrimary = capturePrimary && captureEnabled && Boolean(onCapture);
  const addItemOptions: Array<{
    id: string;
    label: string;
    description: string;
    icon: typeof Upload;
    run: () => void;
    disabled?: boolean;
  }> = [
    {
      id: 'screenshot',
      label: 'Import screenshot',
      description: 'Import an image into this collection',
      icon: Upload,
      run: onImport,
    },
    ...(onCapture
      ? [
          {
            id: 'capture',
            label: 'Take screenshot',
            description: captureEnabled
              ? 'Capture a region on a chosen display'
              : (captureDisabledLabel ?? 'Screen capture is experimental — enable it in Settings'),
            icon: Camera,
            run: () => onCapture(),
            disabled: !captureEnabled || captureInProgress,
          },
          {
            id: 'capture-delay-3',
            label: 'Take screenshot in 3 seconds',
            description: captureEnabled
              ? 'Wait so hover menus and tooltips can appear'
              : (captureDisabledLabel ?? 'Screen capture is experimental — enable it in Settings'),
            icon: Timer,
            run: () => onCapture(3),
            disabled: !captureEnabled || captureInProgress,
          },
          {
            id: 'capture-delay-5',
            label: 'Take screenshot in 5 seconds',
            description: captureEnabled
              ? 'Wait so hover menus and tooltips can appear'
              : (captureDisabledLabel ?? 'Screen capture is experimental — enable it in Settings'),
            icon: Timer,
            run: () => onCapture(5),
            disabled: !captureEnabled || captureInProgress,
          },
        ]
      : []),
    ...(onAddContent
      ? [
          {
            id: 'drawing',
            label: 'Drawing',
            description: 'Sketch a visual explanation',
            icon: Pencil,
            run: () => void onAddContent('drawing'),
          },
          {
            id: 'text',
            label: 'Text block',
            description: 'Add Markdown to the prompt sequence',
            icon: FileText,
            run: () => void onAddContent('text'),
          },
        ]
      : []),
  ];

  const closeAddMenu = (restoreFocus = false) => {
    setAddMenuOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => addMenuTriggerRef.current?.focus());
  };

  const openAddMenu = (focusedIndex = 0) => {
    setAddMenuFocusedIndex(Math.min(Math.max(focusedIndex, 0), addItemOptions.length - 1));
    setAddMenuOpen(true);
  };

  useEffect(() => {
    if (!addMenuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) closeAddMenu();
    };
    document.addEventListener('pointerdown', closeMenu);
    const frame = window.requestAnimationFrame(() => addMenuItemRefs.current[addMenuFocusedIndex]?.focus());
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      window.cancelAnimationFrame(frame);
    };
  }, [addMenuFocusedIndex, addMenuOpen]);

  async function reorderScreenshot(targetIndex: number, sourceIndex = dragIndex) {
    if (sourceIndex === null || sourceIndex === targetIndex || !project) return;
    const sourceId = shots[sourceIndex]?.id;
    const targetId = shots[targetIndex]?.id;
    const activeBefore = useAppStore.getState().activeScreenshotId;
    if (!(await onFlush())) return;
    const after = useAppStore.getState();
    const latest = after.snapshot?.project;
    if (!latest || latest.id !== project.id || after.activeCollectionId !== store.activeCollectionId) return;
    const remap = (id: string | undefined) =>
      id === activeBefore && after.activeScreenshotId !== activeBefore ? after.activeScreenshotId : id;
    const ordered = orderedCollectionItems(latest, store.activeCollectionId);
    const latestSource = ordered.findIndex((item) => item.id === remap(sourceId));
    const latestTarget = ordered.findIndex((item) => item.id === remap(targetId));
    if (latestSource < 0 || latestTarget < 0) return;
    const [moved] = ordered.splice(latestSource, 1);
    if (!moved) return;
    ordered.splice(latestTarget, 0, moved);
    const positions = new Map(ordered.map((item, position) => [item.id, position]));
    const next = {
      ...latest,
      updatedAt: nowIso(),
      screenshots: latest.screenshots.map((item) => ({
        ...item,
        position: positions.get(item.id) ?? item.position,
      })),
      ...(latest.contentItems
        ? {
            contentItems: latest.contentItems.map((item) => ({
              ...item,
              position: positions.get(item.id) ?? item.position,
            })),
          }
        : {}),
    };
    store.updateProject(next);
    setDragIndex(null);
    if (!(await onSaveProject(next))) onMessage('The new item order remains open but has not been saved.');
  }

  async function toggleVisibility(screenshot: (typeof shots)[number]) {
    if (!project) return;
    const activeBefore = useAppStore.getState().activeScreenshotId;
    if (!(await onFlush())) return;
    const after = useAppStore.getState();
    const latest = after.snapshot?.project;
    if (!latest || latest.id !== project.id || after.activeCollectionId !== store.activeCollectionId) return;
    const targetId =
      screenshot.id === activeBefore && after.activeScreenshotId !== activeBefore
        ? after.activeScreenshotId
        : screenshot.id;
    const next = {
      ...latest,
      updatedAt: nowIso(),
      screenshots: latest.screenshots.map((item) =>
        item.id === targetId ? { ...item, includeInExport: !item.includeInExport } : item,
      ),
      ...(latest.contentItems
        ? {
            contentItems: latest.contentItems.map((item) =>
              item.id === targetId ? { ...item, includeInExport: !item.includeInExport } : item,
            ),
          }
        : {}),
    };
    store.updateProject(next);
    if (!(await onSaveProject(next)))
      onMessage('The include/exclude change remains open but has not been saved.');
  }

  return (
    <aside
      className={`shot-rail ${store.leftPanelOpen ? '' : 'collapsed'}`}
      aria-label="Collections and content"
      data-testid="collection-rail"
    >
      <div className="rail-heading">
        {store.leftPanelOpen && (
          <div>
            <strong>{project?.name}</strong>
          </div>
        )}
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
          <div className="shot-list" aria-label="Content sequence">
            {shots.map((item, index) => (
              <div
                key={item.id}
                draggable
                className={`shot-item ${item.id === store.activeScreenshotId ? 'active' : ''} ${item.includeInExport ? '' : 'excluded'}`}
                onDragStart={() => setDragIndex(index)}
                onDragEnd={() => setDragIndex(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void reorderScreenshot(index);
                }}
              >
                <button
                  className="shot-select"
                  onClick={() => void onSelectScreenshot(item.id)}
                  data-testid={`screenshot-${item.id}`}
                  onKeyDown={(event) => {
                    if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
                      event.preventDefault();
                      const next = index + (event.key === 'ArrowUp' ? -1 : 1);
                      if (next >= 0 && next < shots.length) void reorderScreenshot(next, index);
                    }
                  }}
                  title="Alt + Up/Down to reorder"
                >
                  <span className="shot-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="thumb">
                    {store.snapshot?.thumbnails[item.id] ? (
                      <img src={store.snapshot.thumbnails[item.id]} alt="" />
                    ) : item.kind === 'text' ? (
                      <FileText size={18} aria-hidden="true" />
                    ) : item.kind === 'drawing' ? (
                      <Pencil size={18} aria-hidden="true" />
                    ) : (
                      <FileImage size={18} aria-hidden="true" />
                    )}
                  </div>
                  <span className="shot-copy">
                    <strong>
                      {item.kind === 'text'
                        ? item.preview || 'Text block'
                        : item.title || (item.kind === 'screenshot' ? item.originalFilename : 'Drawing')}
                    </strong>
                    <small>
                      {'conflict' in item && item.conflict
                        ? item.includeInExport
                          ? 'Copy conflict · included manually · '
                          : 'Copy conflict · excluded · '
                        : ''}
                      {item.kind === 'screenshot'
                        ? `${item.priority} priority`
                        : item.kind === 'drawing'
                          ? 'Drawing'
                          : 'Markdown'}
                    </small>
                  </span>
                </button>
                <div className="shot-item-actions">
                  <IconButton
                    data-testid={`screenshot-export-toggle-${item.id}`}
                    className="shot-visibility"
                    label={
                      item.includeInExport
                        ? `Exclude ${item.kind === 'text' ? item.preview || 'text block' : item.title} from prompt`
                        : `Include ${item.kind === 'text' ? item.preview || 'text block' : item.title} in prompt`
                    }
                    aria-pressed={item.includeInExport}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleVisibility(item);
                    }}
                  >
                    {item.includeInExport ? (
                      <Eye size={16} aria-hidden="true" />
                    ) : (
                      <EyeOff size={16} aria-hidden="true" />
                    )}
                  </IconButton>
                  {onDeleteItem && (
                    <IconButton
                      className="shot-delete"
                      data-testid={`item-delete-${item.id}`}
                      label={`Delete ${item.kind === 'text' ? 'text block' : item.kind}: ${item.kind === 'text' ? item.preview || 'Text block' : item.title}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onDragStart={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onDeleteItem(item.id, item.kind);
                      }}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </IconButton>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="rail-actions">
            <div className="add-item-menu" ref={addMenuRef}>
              {screenshotFirstAdd ? (
                <div className="add-item-primary">
                  <Button
                    variant="primary"
                    disabled={collection?.archived || (captureIsPrimary && captureInProgress)}
                    busy={captureIsPrimary && captureInProgress}
                    data-testid="add-screenshot"
                    title={
                      collection?.archived
                        ? 'Choose a current collection before adding screenshots'
                        : undefined
                    }
                    onClick={captureIsPrimary ? () => onCapture?.() : onImport}
                  >
                    {captureIsPrimary ? (
                      <Camera size={15} aria-hidden="true" />
                    ) : (
                      <Upload size={15} aria-hidden="true" />
                    )}
                    Add screenshot
                  </Button>
                  <Button
                    ref={addMenuTriggerRef}
                    data-testid="add-item-trigger"
                    variant="soft"
                    disabled={collection?.archived}
                    aria-label="More ways to add"
                    aria-expanded={addMenuOpen}
                    aria-haspopup="menu"
                    aria-controls={addMenuId}
                    onClick={() => (addMenuOpen ? closeAddMenu() : openAddMenu())}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown' || event.key === 'Home') {
                        event.preventDefault();
                        openAddMenu(0);
                      } else if (event.key === 'ArrowUp' || event.key === 'End') {
                        event.preventDefault();
                        openAddMenu(addItemOptions.length - 1);
                      } else if (event.key === 'Escape' && addMenuOpen) {
                        event.preventDefault();
                        closeAddMenu(true);
                      }
                    }}
                  >
                    <ChevronDown size={14} aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <Button
                  ref={addMenuTriggerRef}
                  data-testid="add-item-trigger"
                  variant="primary"
                  disabled={collection?.archived}
                  aria-expanded={addMenuOpen}
                  aria-haspopup="menu"
                  aria-controls={addMenuId}
                  onClick={() => (addMenuOpen ? closeAddMenu() : openAddMenu())}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'Home') {
                      event.preventDefault();
                      openAddMenu(0);
                    } else if (event.key === 'ArrowUp' || event.key === 'End') {
                      event.preventDefault();
                      openAddMenu(addItemOptions.length - 1);
                    } else if (event.key === 'Escape' && addMenuOpen) {
                      event.preventDefault();
                      closeAddMenu(true);
                    }
                  }}
                >
                  <Plus size={15} aria-hidden="true" />
                  Add item
                  <ChevronDown size={14} aria-hidden="true" />
                </Button>
              )}
              {addMenuOpen && (
                <div
                  className="add-item-popover"
                  id={addMenuId}
                  role="menu"
                  aria-label="Add item"
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) closeAddMenu();
                  }}
                >
                  {addItemOptions.map((option, index) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.id}
                        ref={(element) => {
                          addMenuItemRefs.current[index] = element;
                        }}
                        type="button"
                        role="menuitem"
                        tabIndex={index === addMenuFocusedIndex ? 0 : -1}
                        data-testid={`add-item-${option.id}`}
                        aria-disabled={option.disabled || undefined}
                        onClick={() => {
                          if (option.disabled) return;
                          option.run();
                          closeAddMenu();
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            setAddMenuFocusedIndex((current) => (current + 1) % addItemOptions.length);
                          } else if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            setAddMenuFocusedIndex(
                              (current) => (current - 1 + addItemOptions.length) % addItemOptions.length,
                            );
                          } else if (event.key === 'Home') {
                            event.preventDefault();
                            setAddMenuFocusedIndex(0);
                          } else if (event.key === 'End') {
                            event.preventDefault();
                            setAddMenuFocusedIndex(addItemOptions.length - 1);
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            closeAddMenu(true);
                          }
                        }}
                      >
                        <Icon size={15} aria-hidden="true" />
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
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
