import { useState } from 'react';
import Konva from 'konva';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Annotation } from '../../shared/types';
import { AnnotationCanvas } from './AnnotationCanvas';
import type { ToolChoice } from './Toolbar';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
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
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountCanvas(initialTool: ToolChoice = 'rectangle') {
  const image = document.createElement('img');
  vi.spyOn(window, 'Image').mockImplementation(function () {
    return image;
  });
  const stageRef = { current: null as Konva.Stage | null };
  let saved: Annotation[] = [];
  function Harness() {
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [tool, setTool] = useState(initialTool);
    return (
      <AnnotationCanvas
        image={{ filename: 'fixture.png', dataUrl: 'data:image/png;base64,fixture', width: 900, height: 600 }}
        annotations={annotations}
        selectedId={selectedId}
        tool={tool}
        onChange={(next) => {
          saved = next;
          setAnnotations(next);
        }}
        onSelect={setSelectedId}
        onTool={setTool}
        stageRef={stageRef}
        theme="dark"
      />
    );
  }
  render(<Harness />);
  fireEvent.load(image);
  const stage = stageRef.current!;
  const captured = new Set<number>();
  Object.defineProperties(stage.content, {
    setPointerCapture: { value: (id: number) => captured.add(id) },
    hasPointerCapture: { value: (id: number) => captured.has(id) },
    releasePointerCapture: { value: (id: number) => captured.delete(id) },
  });
  const canvas = screen.getByTestId('annotation-canvas');
  function pointer(type: string, x: number, y: number, shiftKey = false) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
      shiftKey,
    });
    Object.defineProperties(event, { pointerId: { value: 7 }, pointerType: { value: 'mouse' } });
    act(() => stage.content.dispatchEvent(event));
    return event;
  }
  return { stage, canvas, pointer, saved: () => saved };
}

test('a real Konva stage click following React pointerup keeps the new square selected for immediate nudges', () => {
  const { stage, canvas, pointer, saved } = mountCanvas();
  const events: { type: string; event: Event; target: Konva.Node }[] = [];
  stage.on('pointerup.regression pointerclick.regression', (event) => {
    events.push({ type: event.type, event: event.evt, target: event.target });
  });
  pointer('pointerdown', 200, 200);
  pointer('pointermove', 270, 220, true);
  const up = pointer('pointerup', 270, 220, true);
  expect(events.map((event) => event.type)).toEqual(['pointerup', 'pointerclick']);
  expect(events.every((event) => event.event === up && event.target === stage)).toBe(true);
  const rectangle = saved()[0];
  expect(rectangle.width).toBe(rectangle.height);
  expect(screen.getByTestId('annotation-canvas-status')).toHaveTextContent('selected, 1 of');
  fireEvent.keyDown(canvas, { key: 'ArrowRight' });
  fireEvent.keyDown(canvas, { key: 'ArrowDown', shiftKey: true });
  expect(saved()[0]).toMatchObject({ x: rectangle.x + 1, y: rectangle.y + 10 });
  // This is a subsequent single click, outside Konva's double-click window.
  vi.advanceTimersByTime(Konva.dblClickWindow + 1);
  pointer('pointerdown', 600, 400);
  pointer('pointerup', 600, 400);
  expect(screen.getByTestId('annotation-canvas-status')).toBeEmptyDOMElement();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  fireEvent.keyDown(canvas, { key: 'ArrowRight' });
  expect(saved()[0]).toMatchObject({ x: rectangle.x + 1, y: rectangle.y + 10 });
  // Hit testing is the only canvas-raster operation substituted in jsdom. The node's real click bubbles.
  vi.spyOn(stage, 'getIntersection').mockReturnValue(stage.findOne(`#${rectangle.id}`) as Konva.Shape);
  vi.advanceTimersByTime(Konva.dblClickWindow + 1);
  pointer('pointerdown', 240, 240);
  pointer('pointerup', 240, 240);
  expect(screen.getByTestId('annotation-canvas-status')).toHaveTextContent('selected, 1 of');
});

test.each(['ellipse', 'arrow', 'pen'] as const)(
  '%s creation retains selection and moves the saved whole mark',
  (tool) => {
    const { canvas, pointer, saved } = mountCanvas(tool);
    pointer('pointerdown', 200, 200);
    pointer('pointermove', 270, 230, true);
    pointer('pointerup', 270, 230, true);
    const mark = saved()[0];
    expect(screen.getByTestId('annotation-canvas-status')).toHaveTextContent('selected, 1 of');
    fireEvent.keyDown(canvas, { key: 'ArrowLeft', shiftKey: true });
    expect(saved()[0]).toMatchObject({ x: mark.x - 10, y: mark.y });
    expect(saved()[0].points).toEqual(mark.points);
  },
);

test('pointer cancellation with lost native capture abandons the draft before the next gesture', async () => {
  const { pointer, saved } = mountCanvas();
  pointer('pointerdown', 200, 200);
  pointer('pointermove', 270, 230);
  pointer('pointercancel', 270, 230);
  pointer('lostpointercapture', 270, 230);
  await act(async () => {
    await Promise.resolve();
  });
  pointer('pointerup', 270, 230);
  expect(saved()).toEqual([]);
  pointer('pointerdown', 200, 200);
  pointer('pointermove', 270, 230);
  pointer('pointerup', 270, 230);
  expect(saved()).toHaveLength(1);
  expect(screen.getByTestId('annotation-canvas-status')).toHaveTextContent('selected, 1 of');
});

test.each(['text', 'callout'] as const)(
  '%s keeps its pending editor through the pointer click and cancellation saves no empty note',
  (tool) => {
    const { pointer, saved } = mountCanvas(tool);
    pointer('pointerdown', 200, 200);
    pointer('pointerup', 200, 200);
    const editor = screen.getByRole('textbox', { name: 'Edit annotation text' });
    expect(document.activeElement).toBe(editor);
    expect(saved()).toEqual([]);
    fireEvent.keyDown(editor, { key: 'ArrowRight' });
    expect(saved()).toEqual([]);
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Edit annotation text' })).not.toBeInTheDocument();
    expect(saved()).toEqual([]);
  },
);

test('crop completion keeps a preview and waits for Apply rather than selecting a saved mark', () => {
  const { pointer, saved } = mountCanvas('crop');
  pointer('pointerdown', 200, 200);
  pointer('pointermove', 270, 230, true);
  pointer('pointerup', 270, 230, true);
  expect(saved()).toEqual([]);
  expect(screen.getByTestId('annotation-canvas-status')).toBeEmptyDOMElement();
  fireEvent.click(screen.getByRole('button', { name: 'Apply crop' }));
  expect(saved()[0]).toMatchObject({ kind: 'crop' });
  expect(screen.getByTestId('annotation-canvas-status')).toBeEmptyDOMElement();
});
