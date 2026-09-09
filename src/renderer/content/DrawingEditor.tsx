import {
  ArrowUpRight,
  Circle,
  Diamond,
  Frame,
  MousePointer2,
  Pencil,
  RectangleHorizontal,
  Square,
  Type,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Excalidraw, getSceneVersion, serializeAsJSON } from '@excalidraw/excalidraw';
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  ExcalidrawProps,
} from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import './content-editors.css';
import '../components/canvas-surface.css';
import { DrawingSourceError, isAllowedDrawingElement, parseDrawingSource } from './drawing-render';

type DrawingTool =
  'selection' | 'rectangle' | 'ellipse' | 'diamond' | 'frame' | 'text' | 'arrow' | 'line' | 'freedraw';

type ToolButton = {
  label: string;
  tool: DrawingTool;
  icon: typeof MousePointer2;
  rounded?: boolean;
};

type ActiveTool = Pick<ToolButton, 'tool' | 'rounded'>;

const tools: ToolButton[] = [
  { label: 'Select', tool: 'selection', icon: MousePointer2 },
  { label: 'Rectangle', tool: 'rectangle', icon: Square },
  { label: 'Rounded rectangle', tool: 'rectangle', icon: RectangleHorizontal, rounded: true },
  { label: 'Ellipse', tool: 'ellipse', icon: Circle },
  { label: 'Diamond', tool: 'diamond', icon: Diamond },
  { label: 'Frame', tool: 'frame', icon: Frame },
  { label: 'Text', tool: 'text', icon: Type },
  { label: 'Arrow', tool: 'arrow', icon: ArrowUpRight },
  { label: 'Line', tool: 'line', icon: RectangleHorizontal },
  { label: 'Freehand', tool: 'freedraw', icon: Pencil },
];

function initialDataFromSource(source: string): ExcalidrawInitialDataState {
  const drawing = parseDrawingSource(source);
  return {
    ...drawing,
    appState: { ...drawing.appState, viewBackgroundColor: 'transparent' },
  } as ExcalidrawInitialDataState;
}

export function DrawingEditor({
  source,
  onChange,
  theme,
}: {
  source: string;
  onChange: (source: string) => void;
  theme: 'light' | 'dark';
}) {
  // The embedding surface keys this component by content item. Initial data is
  // intentionally read once, so a parent autosave never reloads an active canvas.
  const [loaded] = useState(() => {
    try {
      const background = parseDrawingSource(source).appState.viewBackgroundColor;
      return {
        initialData: initialDataFromSource(source),
        sourceBackground: typeof background === 'string' ? background : '#ffffff',
        error: null,
      };
    } catch (error) {
      const message =
        error instanceof DrawingSourceError ? error.message : 'This drawing could not be loaded.';
      return { initialData: null, error: message };
    }
  });
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const sourceRef = useRef(source);
  const sceneVersionRef = useRef<number | null>(null);
  const interactionRef = useRef(false);
  const [activeTool, setActiveTool] = useState<ActiveTool>({ tool: 'selection' });

  const selectTool = useCallback((button: ToolButton) => {
    interactionRef.current = true;
    const api = apiRef.current;
    if (!api) return;

    api.updateScene({
      appState: {
        currentItemRoundness: button.rounded ? 'round' : 'sharp',
      },
    });
    api.setActiveTool({ type: button.tool });
    setActiveTool({ tool: button.tool, rounded: button.rounded });
  }, []);

  const uiOptions = useMemo<ExcalidrawProps['UIOptions']>(
    () => ({
      canvasActions: {
        changeViewBackgroundColor: false,
        clearCanvas: false,
        export: false,
        loadScene: false,
        saveAsImage: false,
        saveToActiveFile: false,
        toggleTheme: false,
      },
      tools: { image: false },
    }),
    [],
  );

  if (loaded.error || !loaded.initialData) {
    return (
      <section
        className="drawing-editor"
        data-content-editor="drawing"
        data-testid="drawing-editor"
        aria-label="Drawing editor"
      >
        <div className="content-loading" role="alert">
          {loaded.error}
        </div>
      </section>
    );
  }

  return (
    <section
      className="drawing-editor"
      data-content-editor="drawing"
      data-testid="drawing-editor"
      aria-label="Drawing editor"
    >
      <div className="drawing-editor-tools" aria-label="Drawing tools">
        {tools.map((button) => {
          const Icon = button.icon;
          const selected = activeTool.tool === button.tool && activeTool.rounded === button.rounded;
          return (
            <button
              key={button.label}
              className={selected ? 'drawing-tool is-active' : 'drawing-tool'}
              type="button"
              title={button.label}
              aria-label={button.label}
              aria-pressed={selected}
              disabled={!engineReady}
              data-testid={`drawing-tool-${button.label.toLowerCase().replaceAll(' ', '-')}`}
              onClick={() => selectTool(button)}
            >
              <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
            </button>
          );
        })}
        <span className="drawing-editor-shortcut" title="Select shapes and press Ctrl/⌘ + G to group">
          Group: Ctrl/⌘G
        </span>
      </div>
      <div
        className="drawing-editor-canvas canvas-workspace-surface"
        data-testid="drawing-editor-canvas"
        onKeyDownCapture={() => {
          interactionRef.current = true;
        }}
      >
        <Excalidraw
          initialData={loaded.initialData}
          theme={theme}
          autoFocus
          handleKeyboardGlobally={false}
          UIOptions={uiOptions}
          validateEmbeddable={() => false}
          onPaste={(data) => {
            const hasFiles = Boolean(data.files && Object.keys(data.files).length > 0);
            const hasImageUrl = data.mixedContent?.some((item) => item.type === 'imageUrl') ?? false;
            const hasUnsupportedElements =
              data.elements?.some((element) => !isAllowedDrawingElement(element)) ?? false;
            return !hasFiles && !hasImageUrl && !hasUnsupportedElements;
          }}
          onLinkOpen={(element, event) => {
            if (element.link) event.preventDefault();
          }}
          excalidrawAPI={(api) => {
            apiRef.current = api;
            setEngineReady(true);
          }}
          onPointerDown={() => {
            interactionRef.current = true;
          }}
          onChange={(elements, appState) => {
            const engineTool = appState.activeTool.type;
            const nextTool = tools.some((button) => button.tool === engineTool)
              ? (engineTool as DrawingTool)
              : 'selection';
            const rounded = nextTool === 'rectangle' && appState.currentItemRoundness === 'round';
            setActiveTool((current) =>
              current.tool === nextTool && current.rounded === rounded
                ? current
                : { tool: nextTool, rounded },
            );

            const sceneVersion = getSceneVersion(elements);
            // Excalidraw emits on mount and when only its view state changes.
            // Establish the first version silently, then persist only scene edits.
            if (sceneVersionRef.current === null) {
              sceneVersionRef.current = sceneVersion;
              return;
            }
            if (!interactionRef.current || sceneVersion === sceneVersionRef.current) return;
            if (elements.some((element) => !isAllowedDrawingElement(element))) return;
            sceneVersionRef.current = sceneVersion;

            // The transparent editor reveals the shared workspace outside Excalidraw's
            // dark color filter. Never persist this display-only background.
            const nextSource = serializeAsJSON(
              elements,
              { ...appState, viewBackgroundColor: loaded.sourceBackground },
              {},
              'local',
            );
            if (nextSource === sourceRef.current) return;
            sourceRef.current = nextSource;
            onChange(nextSource);
          }}
        />
      </div>
    </section>
  );
}
