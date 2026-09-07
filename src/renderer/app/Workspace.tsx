import { Copy, ImagePlus, PanelRight, Trash2, Upload } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ContentItemContent } from '../../shared/content-items';
import type Konva from 'konva';
import type {
  Annotation,
  AnnotationKind,
  ImagePayload,
  ProjectData,
  ProjectSnapshot,
  ScreenshotRecord,
} from '../../shared/types';
import { CollectionRail } from '../collection/CollectionRail';
import { AnnotationCanvas } from '../components/AnnotationCanvas';
import { Toolbar, type ToolChoice } from '../components/Toolbar';
import { Button, EmptyState, IconButton } from '../components/ui';
import { ScreenshotInspector } from '../inspector/ScreenshotInspector';
import { useAppStore } from '../store';
import { TextBlockEditor } from '../content/TextBlockEditor';

const DrawingEditor = lazy(() =>
  import('../content/DrawingEditor').then((module) => ({ default: module.DrawingEditor })),
);

export interface WorkspaceProps {
  content?: ContentItemContent | null;
  contentLoading?: boolean;
  contentSaveState?: 'saved' | 'saving' | 'error';
  onContentChange?(patch: { source?: string; markdown?: string }): void;
  onContentRetry?(): void;
  onAddContent?(kind: 'drawing' | 'text'): void | Promise<void>;
  onDuplicateContent?(): void | Promise<void>;
  onDeleteContent?(): void | Promise<void>;
  onDrawingTitle?(title: string): void;
  image: ImagePayload | null;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  tool: ToolChoice;
  annotationColor: string;
  paletteColor: string;
  resolvedTheme: 'light' | 'dark';
  stageRef: React.MutableRefObject<Konva.Stage | null>;
  saveState: 'saved' | 'saving' | 'error';
  canUndo: boolean;
  canRedo: boolean;
  canUndoDescription: boolean;
  shortcutLabels: Partial<Record<string, string>>;
  onTool(tool: 'select' | AnnotationKind | 'eraser'): void;
  onColor(color: string): void;
  onChangeAnnotations(next: Annotation[]): void;
  onSelectAnnotation(id: string | null): void;
  onUndo(): void;
  onRedo(): void;
  onFit(): void;
  onActualSize(): void;
  onZoom(delta: number): void;
  onFlush(): Promise<boolean>;
  onSaveProject(project: ProjectData): Promise<boolean>;
  onUpdateProject(project: ProjectData): void;
  onSnapshot(snapshot: ProjectSnapshot, selectScreenshotId?: string): void | Promise<void>;
  onSelectScreenshot(id: string): void | Promise<void>;
  onSelectCollection(id: string): void | Promise<void>;
  onImport(): void;
  onPaste(): void | Promise<void>;
  onMessage(message: string): void;
  onUpdateShot(patch: Partial<ScreenshotRecord>): void;
  onDescriptionChange(value: string): void;
  onUndoDescription(): void;
  onDuplicate(): void | Promise<void>;
  onDeleteScreenshot(): void | Promise<void>;
  onDeleteProject(): void;
}

export function Workspace(props: WorkspaceProps) {
  const store = useAppStore();
  const inspectorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const inspectorDrawerRef = useRef<HTMLDivElement>(null);
  const inspectorReturnFocus = useRef<HTMLElement | null>(null);
  const [narrowViewport, setNarrowViewport] = useState(() => window.matchMedia('(max-width: 950px)').matches);
  const shot = store.activeScreenshot();
  const item = store.snapshot?.project.contentItems?.find((entry) => entry.id === store.activeScreenshotId);
  const saveState = item ? (props.contentSaveState ?? 'saved') : props.saveState;
  const selectedAnnotation = props.selectedAnnotationId
    ? (props.annotations.find((item) => item.id === props.selectedAnnotationId) ?? null)
    : null;
  const closeInspector = useCallback(() => useAppStore.getState().set({ rightPanelOpen: false }), []);
  const restoreInspectorFocus = useCallback(() => {
    const previous = inspectorReturnFocus.current;
    const target =
      previous?.isConnected && !previous.hasAttribute('data-drawer-autofocus')
        ? previous
        : (inspectorTriggerRef.current ??
          document.querySelector<HTMLButtonElement>('[data-testid="inspector-toggle"]'));
    target?.focus();
  }, []);
  const dismissInspector = useCallback(() => {
    closeInspector();
    restoreInspectorFocus();
  }, [closeInspector, restoreInspectorFocus]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 950px)');
    const updateViewport = () => setNarrowViewport(media.matches);
    media.addEventListener?.('change', updateViewport);
    return () => media.removeEventListener?.('change', updateViewport);
  }, []);

  useEffect(() => {
    if (!store.rightPanelOpen || !narrowViewport) return;
    const drawer = inspectorDrawerRef.current;
    inspectorReturnFocus.current =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    const focusTarget = drawer?.querySelector<HTMLElement>('[data-drawer-autofocus]') ?? drawer;
    focusTarget?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !drawer?.contains(event.target as Node)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissInspector();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreInspectorFocus();
    };
  }, [dismissInspector, narrowViewport, restoreInspectorFocus, store.rightPanelOpen]);
  return (
    <section
      className="workspace"
      data-testid="workspace"
      data-left-panel={store.leftPanelOpen ? 'open' : 'closed'}
      data-right-panel={store.rightPanelOpen ? 'open' : 'closed'}
      style={{
        gridTemplateColumns: `${store.leftPanelOpen ? 'minmax(190px, 236px)' : '48px'} minmax(0, 1fr)${store.rightPanelOpen && !narrowViewport ? ' minmax(256px, 304px)' : ''}`,
      }}
    >
      <CollectionRail
        onFlush={props.onFlush}
        onSaveProject={props.onSaveProject}
        onUpdateProject={props.onUpdateProject}
        onSelectScreenshot={props.onSelectScreenshot}
        onSelectCollection={props.onSelectCollection}
        onImport={props.onImport}
        onPaste={props.onPaste}
        onMessage={props.onMessage}
        onSnapshot={props.onSnapshot}
        onAddContent={props.onAddContent}
      />
      <div className="canvas-column">
        <div className="workspace-toolbar">
          {item ? (
            <strong className="content-editor-heading">
              {item.kind === 'drawing' ? 'Drawing' : 'Text block'}
            </strong>
          ) : (
            <Toolbar
              tool={props.tool}
              setTool={props.onTool}
              onUndo={props.onUndo}
              onRedo={props.onRedo}
              canUndo={props.canUndo}
              canRedo={props.canRedo}
              onZoom={props.onZoom}
              onFit={props.onFit}
              onActualSize={props.onActualSize}
              onColorSelect={props.onColor}
              selectedColor={props.paletteColor}
              shortcutLabels={props.shortcutLabels}
            />
          )}
          <div className="canvas-actions">
            <span className={`save-state ${saveState}`} data-testid="save-state" role="status">
              <span className="save-dot" />
              {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
            </span>
            {item && saveState === 'error' && (
              <Button variant="ghost" onClick={props.onContentRetry}>
                Retry save
              </Button>
            )}
            <IconButton
              data-testid="inspector-toggle"
              label={store.rightPanelOpen ? 'Collapse inspector' : 'Expand inspector'}
              onClick={(event) => {
                inspectorTriggerRef.current = event.currentTarget;
                store.set({ rightPanelOpen: !store.rightPanelOpen });
              }}
            >
              <PanelRight size={17} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
        {item ? (
          props.contentLoading || !props.content || props.content.item.id !== item.id ? (
            <div role="status" className="content-loading">
              {props.contentLoading ? 'Loading content…' : 'Content could not be loaded.'}
            </div>
          ) : item.kind === 'drawing' ? (
            <Suspense
              fallback={
                <div role="status" className="content-loading">
                  Loading drawing tools…
                </div>
              }
            >
              <DrawingEditor
                key={item.id}
                source={props.content.source ?? ''}
                theme={props.resolvedTheme}
                onChange={(source) => props.onContentChange?.({ source })}
              />
            </Suspense>
          ) : (
            <TextBlockEditor
              key={item.id}
              value={props.content.markdown ?? ''}
              onChange={(markdown) => props.onContentChange?.({ markdown })}
            />
          )
        ) : shot ? (
          <AnnotationCanvas
            image={props.image}
            annotations={props.annotations}
            selectedId={props.selectedAnnotationId}
            tool={props.tool}
            onChange={props.onChangeAnnotations}
            onSelect={props.onSelectAnnotation}
            onMessage={props.onMessage}
            stageRef={props.stageRef}
            onTool={props.onTool}
            theme={props.resolvedTheme}
            annotationColor={props.annotationColor}
          />
        ) : (
          <EmptyState
            icon={<ImagePlus size={22} aria-hidden="true" />}
            title="Start your collection"
            description="Add a drawing, write some text, or drop a screenshot here."
            action={
              <Button variant="primary" onClick={props.onImport}>
                <Upload size={16} aria-hidden="true" />
                Add screenshot
              </Button>
            }
          />
        )}
      </div>
      {store.rightPanelOpen && (
        <div
          className="inspector-drawer-layer"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) dismissInspector();
          }}
        >
          <div
            ref={inspectorDrawerRef}
            className="inspector-drawer"
            role={narrowViewport ? 'dialog' : undefined}
            aria-modal={narrowViewport ? true : undefined}
            aria-label={narrowViewport ? 'Inspector' : undefined}
            tabIndex={narrowViewport ? -1 : undefined}
          >
            <IconButton
              data-drawer-autofocus
              className="inspector-drawer-close"
              label="Close inspector"
              onClick={dismissInspector}
            >
              ×
            </IconButton>
            {item ? (
              <aside className="inspector content-inspector" aria-label="Content details">
                {item.kind === 'drawing' ? (
                  <label className="field">
                    <span className="field-label">Drawing title</span>
                    <input
                      className="input"
                      aria-label="Drawing title"
                      value={item.title}
                      onChange={(event) => props.onDrawingTitle?.(event.target.value)}
                    />
                  </label>
                ) : (
                  <p>Write Markdown directly. Your text appears at this position in the agent prompt.</p>
                )}
                <p className="content-hint">
                  {item.kind === 'drawing'
                    ? 'Explain this diagram in a text block before or after it.'
                    : 'Use headings, lists, and code blocks to describe the task.'}
                </p>
                <Button variant="soft" onClick={() => void props.onDuplicateContent?.()}>
                  <Copy size={15} aria-hidden="true" />
                  Duplicate {item.kind === 'text' ? 'text' : 'drawing'}
                </Button>
                <Button variant="ghost" onClick={() => void props.onDeleteContent?.()}>
                  <Trash2 size={15} aria-hidden="true" />
                  Delete {item.kind === 'text' ? 'text' : 'drawing'}
                </Button>
              </aside>
            ) : (
              <ScreenshotInspector
                shot={shot}
                selectedAnnotation={selectedAnnotation}
                onUpdateShot={props.onUpdateShot}
                onDescriptionChange={props.onDescriptionChange}
                onUndoDescription={props.onUndoDescription}
                canUndoDescription={props.canUndoDescription}
                onChangeAnnotation={(patch) => {
                  if (!props.selectedAnnotationId) return;
                  props.onChangeAnnotations(
                    props.annotations.map((item) =>
                      item.id === props.selectedAnnotationId ? { ...item, ...patch } : item,
                    ),
                  );
                }}
                onDuplicate={props.onDuplicate}
                onDeleteScreenshot={props.onDeleteScreenshot}
                onDeleteProject={props.onDeleteProject}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
