import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ProjectSnapshot, ScreenshotRecord } from '../../shared/types';
import { useAppStore } from '../store';
import { Workspace, type WorkspaceProps } from './Workspace';

// Keep the real Workspace, ErrorBoundary, AnnotationCanvas and image decoder together.
// Adjacent controls do not participate in canvas mount or recovery behavior.
vi.mock('../collection/CollectionRail', () => ({ CollectionRail: () => <nav>Collection rail</nav> }));
vi.mock('../components/Toolbar', () => ({ Toolbar: () => <div>Annotation tools</div> }));
vi.mock('../inspector/ScreenshotInspector', () => ({ ScreenshotInspector: () => null }));

let images: HTMLImageElement[];
beforeEach(() => {
  images = [];
  vi.spyOn(window, 'Image').mockImplementation(function () {
    const image = document.createElement('img');
    images.push(image);
    return image;
  });
  const context = new Proxy({} as Record<PropertyKey, unknown>, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === 'measureText') return (text: string) => ({ width: text.length * 8 });
      if (property === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return () => undefined;
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  cleanup();
  useAppStore.setState({ snapshot: null, activeScreenshotId: null, rightPanelOpen: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openShot(projectPath = '/fixture/first', id = 'shot-1') {
  const shot: ScreenshotRecord = {
    id,
    collectionId: 'collection',
    originalFilename: 'fixture.png',
    storedFilename: 'fixture.png',
    title: id,
    description: '',
    position: 0,
    createdAt: '',
    updatedAt: '',
    priority: 'medium',
    annotationFile: 'annotations.json',
    descriptionFile: 'description.md',
    originalWidth: 900,
    originalHeight: 600,
    includeInExport: true,
  };
  const snapshot: ProjectSnapshot = {
    projectPath,
    thumbnails: {},
    recoveryFound: false,
    project: {
      schemaVersion: 3,
      id: 'fixture',
      name: 'Fixture',
      description: '',
      createdAt: '',
      updatedAt: '',
      status: 'active',
      favourite: false,
      collections: [],
      screenshots: [shot],
      exportPreferences: {
        includeOriginalScreenshots: true,
        includeAnnotationMetadata: true,
        template: 'default',
      },
    },
  };
  act(() => useAppStore.setState({ snapshot, activeScreenshotId: id, rightPanelOpen: false }));
}

function canvasProps(): WorkspaceProps {
  return {
    image: { filename: 'fixture.png', dataUrl: 'data:image/png;base64,fixture', width: 900, height: 600 },
    annotations: [],
    selectedAnnotationId: null,
    tool: 'text',
    annotationColor: '#ff0000',
    paletteColor: '#ff0000',
    resolvedTheme: 'dark',
    stageRef: { current: null },
    saveState: 'saved',
    canUndo: false,
    canRedo: false,
    canUndoDescription: false,
    shortcutLabels: {},
    onTool: vi.fn(),
    onColor: vi.fn(),
    onChangeAnnotations: vi.fn(),
    onSelectAnnotation: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onFit: vi.fn(),
    onActualSize: vi.fn(),
    onZoom: vi.fn(),
    onFlush: async () => true,
    onSaveProject: async () => true,
    onUpdateProject: vi.fn(),
    onSnapshot: vi.fn(),
    onSelectScreenshot: vi.fn(),
    onSelectCollection: vi.fn(),
    onImport: vi.fn(),
    onPaste: vi.fn(),
    onMessage: vi.fn(),
    onUpdateShot: vi.fn(),
    onDescriptionChange: vi.fn(),
    onUndoDescription: vi.fn(),
    onDuplicate: vi.fn(),
    onDeleteItem: vi.fn(),
  };
}

test.each(['screenshot', 'project'] as const)(
  'switching %s discards the previous canvas pending note without committing it',
  (scope) => {
    openShot();
    const props = canvasProps();
    render(<Workspace {...props} />);
    fireEvent.load(images.at(-1)!);
    const oldStage = props.stageRef.current!;
    Object.defineProperties(oldStage.content, {
      setPointerCapture: { value: () => undefined },
      hasPointerCapture: { value: () => false },
      releasePointerCapture: { value: () => undefined },
    });
    const down = new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 200, clientY: 200 });
    Object.defineProperties(down, { pointerId: { value: 7 }, pointerType: { value: 'mouse' } });
    act(() => oldStage.content.dispatchEvent(down));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit annotation text' }), {
      target: { value: 'Uncommitted note from the previous item' },
    });
    // Identical image bytes and (for a project switch) identical screenshot id must still remount.
    openShot(
      scope === 'project' ? '/fixture/second' : '/fixture/first',
      scope === 'screenshot' ? 'shot-2' : 'shot-1',
    );
    expect(screen.queryByRole('textbox', { name: 'Edit annotation text' })).not.toBeInTheDocument();
    expect(props.onChangeAnnotations).not.toHaveBeenCalled();
    fireEvent.load(images.at(-1)!);
    expect(props.stageRef.current).not.toBe(oldStage);
    expect(screen.getByTestId('annotation-canvas')).toBeInTheDocument();
  },
);

test('a read failure exposes Retry through Workspace and a decode failure can be retried again', () => {
  openShot();
  const props = canvasProps();
  const retry = vi.fn();
  const view = render(<Workspace {...props} image={null} imageLoadFailed onRetryImageLoad={retry} />);
  expect(screen.getByText('This screenshot could not be loaded.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledOnce();
  view.rerender(<Workspace {...props} imageLoadFailed={false} onRetryImageLoad={retry} />);
  expect(screen.getByText('Loading screenshot…')).toBeInTheDocument();
  fireEvent.error(images.at(-1)!);
  expect(screen.getByText('This screenshot could not be loaded.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledTimes(2);
  fireEvent.load(images.at(-1)!);
  expect(props.stageRef.current).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});

test('a canvas render failure stays inside the workspace and another screenshot resets the panel', () => {
  openShot();
  const props = canvasProps();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // Inject the error at the real canvas input boundary, without replacing the canvas or boundary.
  const brokenImage = {
    ...props.image!,
    get width(): number {
      throw new Error('Broken image metadata');
    },
  };
  const view = render(<Workspace {...props} image={brokenImage} />);
  expect(screen.getByTestId('error-fallback-panel')).toHaveTextContent('This item could not be shown');
  expect(screen.getByRole('navigation')).toHaveTextContent('Collection rail');
  view.rerender(<Workspace {...props} />);
  expect(screen.getByTestId('error-fallback-panel')).toBeInTheDocument();
  openShot('/fixture/first', 'shot-2');
  expect(screen.queryByTestId('error-fallback-panel')).not.toBeInTheDocument();
  fireEvent.load(images.at(-1)!);
  expect(props.stageRef.current).not.toBeNull();
});
