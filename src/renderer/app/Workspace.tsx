import { ImagePlus, PanelRight, Upload } from 'lucide-react';
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

export interface WorkspaceProps {
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
  const shot = store.activeScreenshot();
  const selectedAnnotation = props.selectedAnnotationId
    ? (props.annotations.find((item) => item.id === props.selectedAnnotationId) ?? null)
    : null;
  return (
    <section
      className="workspace"
      data-testid="workspace"
      data-left-panel={store.leftPanelOpen ? 'open' : 'closed'}
      data-right-panel={store.rightPanelOpen ? 'open' : 'closed'}
      style={{
        gridTemplateColumns: `${store.leftPanelOpen ? 'minmax(190px, 236px)' : '48px'} minmax(0, 1fr)${store.rightPanelOpen ? ' minmax(256px, 304px)' : ''}`,
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
      />
      <div className="canvas-column">
        <div className="workspace-toolbar">
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
          <div className="canvas-actions">
            <span className={`save-state ${props.saveState}`} data-testid="save-state" role="status">
              <span className="save-dot" />
              {props.saveState === 'saving'
                ? 'Saving…'
                : props.saveState === 'error'
                  ? 'Save failed'
                  : 'Saved'}
            </span>
            <IconButton
              label={store.rightPanelOpen ? 'Collapse inspector' : 'Expand inspector'}
              onClick={() => store.set({ rightPanelOpen: !store.rightPanelOpen })}
            >
              <PanelRight size={17} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
        {shot ? (
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
            title="Add a screenshot to start"
            description="Paste an image, drag files here, or choose Add screenshots."
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
    </section>
  );
}
