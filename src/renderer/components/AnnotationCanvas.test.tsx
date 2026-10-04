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

function mountCanvas(initialTool: ToolChoice = 'rectangle', initialAnnotations: Annotation[] = []) {
  const image = document.createElement('img');
  vi.spyOn(window, 'Image').mockImplementation(function () {
    return image;
  });
  const stageRef = { current: null as Konva.Stage | null };
  let saved: Annotation[] = initialAnnotations;
  let selection: string | null = null;
  function Harness() {
    const [annotations, setAnnotations] = useState<Annotation[]>(initialAnnotations);
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
        onSelect={(id) => {
          selection = id;
          setSelectedId(id);
        }}
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
  function pointer(type: string, x: number, y: number, shiftKey = false, pointerType = 'mouse') {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
      shiftKey,
    });
    Object.defineProperties(event, { pointerId: { value: 7 }, pointerType: { value: pointerType } });
    act(() => stage.content.dispatchEvent(event));
    return event;
  }
  function touch(type: 'touchstart' | 'touchend' | 'touchcancel', x: number, y: number) {
    const contact = { identifier: 7, clientX: x, clientY: y };
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      touches: { value: type === 'touchstart' ? [contact] : [] },
      changedTouches: { value: [contact] },
    });
    act(() => stage.content.dispatchEvent(event));
    return event;
  }
  return { stage, canvas, pointer, touch, captured, saved: () => saved, selected: () => selection };
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

const existingRectangle: Annotation = {
  id: 'existing-rect',
  kind: 'rectangle',
  x: 100,
  y: 100,
  width: 400,
  height: 300,
  fill: 'transparent',
  zIndex: 0,
};

// jsdom has no hit raster. Substitute only the known rectangle/ellipse geometry;
// real Konva DOM dispatch still decides down/up targets and click/tap bubbling.
function rectangleAndEllipseHits(stage: Konva.Stage) {
  const rectangle = stage.findOne('#existing-rect') as Konva.Rect;
  return vi.spyOn(stage, 'getIntersection').mockImplementation((position) => {
    const ellipse = stage.findOne('Ellipse') as Konva.Ellipse | undefined;
    if (ellipse) {
      const point = ellipse.getAbsoluteTransform().copy().invert().point(position);
      const radius = ellipse.radiusX(); // These fixtures draw circles with Shift.
      if (Math.abs(Math.hypot(point.x, point.y) - radius) <= ellipse.strokeWidth() / 2) return ellipse;
    }
    const point = rectangle.getAbsoluteTransform().copy().invert().point(position);
    return point.x >= 0 && point.x <= rectangle.width() && point.y >= 0 && point.y <= rectangle.height()
      ? rectangle
      : null;
  });
}

test.each(['mouse', 'touch'] as const)(
  'ellipse completion over an existing shape keeps the new selection through %s duplicates and later clicks',
  (input) => {
    const f = mountCanvas('ellipse', [existingRectangle]);
    rectangleAndEllipseHits(f.stage);
    const events: { type: string; native: Event; target: Konva.Node }[] = [];
    f.stage.on(
      'pointerdown.regression pointerup.regression pointerclick.regression tap.regression',
      (event) => {
        events.push({ type: event.type, native: event.evt, target: event.target });
      },
    );
    // Pair compatibility starts in one dispatch turn, before React mounts the draft.
    act(() => {
      f.pointer('pointerdown', 200, 200, false, input);
      if (input === 'mouse') f.pointer('mousedown', 200, 200);
      else f.touch('touchstart', 200, 200);
    });
    f.pointer('pointermove', 270, 270, true, input);
    const ellipse = f.stage.findOne('Ellipse') as Konva.Ellipse;
    const corner = ellipse.getAbsoluteTransform().copy().invert().point({ x: 270, y: 270 });
    expect(Math.hypot(corner.x, corner.y) - ellipse.radiusX()).toBeGreaterThan(ellipse.strokeWidth() / 2);
    const up = f.pointer('pointerup', 270, 270, true, input);
    if (input === 'mouse') {
      f.pointer('mouseup', 270, 270);
      f.pointer('click', 270, 270);
    } else f.touch('touchend', 270, 270);
    expect(events.filter((event) => event.type.startsWith('pointer')).map((event) => event.type)).toEqual([
      'pointerdown',
      'pointerup',
      'pointerclick',
    ]);
    expect(events.every((event) => event.target.id() === existingRectangle.id)).toBe(true);
    expect(events.find((event) => event.type === 'pointerclick')?.native).toBe(up);
    if (input === 'touch') expect(events.some((event) => event.type === 'tap')).toBe(true);
    const mark = f.saved()[1];
    expect(mark.kind).toBe('ellipse');
    expect(f.selected()).toBe(mark.id);
    fireEvent.keyDown(f.canvas, { key: 'ArrowRight' });
    expect(f.saved()[1].x).toBe(mark.x + 1);
    expect(f.saved()[0]).toEqual(existingRectangle);

    // A new pointerdown ends the guard even if completion's click never arrived.
    vi.advanceTimersByTime(Konva.dblClickWindow + 1);
    f.pointer('pointerdown', 600, 400, false, input);
    f.pointer('pointerup', 600, 400, false, input);
    expect(f.selected()).toBeNull();
    vi.advanceTimersByTime(Konva.dblClickWindow + 1);
    f.pointer('pointerdown', 180, 200, false, input);
    if (input === 'touch') f.touch('touchstart', 180, 200);
    f.pointer('pointerup', 180, 200, false, input);
    if (input === 'touch') f.touch('touchend', 180, 200);
    expect(f.selected()).toBe(existingRectangle.id);
  },
);

test.each(['pointercancel', 'touchcancel'] as const)(
  'native %s hitting the owned draft emits Konva pointerup but saves nothing, even after lost capture',
  async (cancelType) => {
    const f = mountCanvas();
    f.pointer('pointerdown', 200, 200);
    f.pointer('pointermove', 270, 230);
    const draft = f.stage.find('Rect').find((node) => node.id().startsWith('ann_')) as Konva.Rect;
    expect(draft).toBeDefined();
    expect(f.captured.has(7)).toBe(true);
    // The release point is the filled rectangle's corner, a real listening hit.
    const hit = vi.spyOn(f.stage, 'getIntersection').mockReturnValue(draft);
    const nativeTypes: string[] = [];
    f.stage.on('pointerup.regression', (event) => nativeTypes.push(event.evt.type));
    if (cancelType === 'pointercancel') f.pointer(cancelType, 270, 230);
    else f.touch(cancelType, 270, 230);
    expect(nativeTypes).toEqual([cancelType]);
    expect(f.saved()).toEqual([]); // Abort precedes the later native lost-capture notification.
    f.pointer('lostpointercapture', 270, 230);
    await act(async () => {
      await Promise.resolve();
    });
    hit.mockRestore();
    f.pointer('pointerup', 270, 230);
    expect(f.saved()).toEqual([]);
    expect(f.selected()).toBeNull();
    expect(f.stage.findOne(`#${draft.id()}`)).toBeUndefined();
    f.pointer('pointerdown', 200, 200);
    f.pointer('pointermove', 270, 230);
    f.pointer('pointerup', 270, 230);
    expect(f.saved()).toHaveLength(1);
    expect(f.selected()).toBe(f.saved()[0].id);
  },
);

test.each(['text', 'callout'] as const)(
  '%s stays selected after the creation click and Enter commit',
  (tool) => {
    const f = mountCanvas(tool);
    f.pointer('pointerdown', 200, 200);
    f.pointer('pointerup', 200, 200);
    const editor = screen.getByRole('textbox', { name: 'Edit annotation text' });
    expect(document.activeElement).toBe(editor);
    expect(f.saved()).toEqual([]);
    const pendingId = f.selected();
    expect(pendingId).not.toBeNull();
    fireEvent.change(editor, { target: { value: 'Keep this note selected' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(f.saved()).toHaveLength(1);
    expect(f.saved()[0].text).toBe('Keep this note selected');
    expect(f.saved()[0].id).toBe(pendingId);
    expect(f.selected()).toBe(f.saved()[0].id);
    expect(screen.getByTestId('annotation-canvas-status')).toHaveTextContent('selected, 1 of');
    const beforeNudge = f.saved()[0].y;
    fireEvent.keyDown(f.canvas, { key: 'ArrowDown', shiftKey: true });
    expect(f.saved()[0].y).toBe(beforeNudge + 10);
  },
);

test('a missing completion click does not swallow the next legitimate shape click', () => {
  const f = mountCanvas('ellipse', [existingRectangle]);
  rectangleAndEllipseHits(f.stage);
  const clicks: Event[] = [];
  f.stage.on('pointerclick.regression', (event) => clicks.push(event.evt));
  // Start outside the existing rectangle and end over it: Konva emits no click.
  f.pointer('pointerdown', 100, 100);
  f.pointer('pointermove', 270, 270, true);
  f.pointer('pointerup', 270, 270, true);
  expect(clicks).toEqual([]);
  expect(f.selected()).toBe(f.saved()[1].id);
  vi.advanceTimersByTime(Konva.dblClickWindow + 1);
  f.pointer('pointerdown', 180, 200);
  f.pointer('pointerup', 180, 200);
  expect(clicks).toHaveLength(1);
  expect(f.selected()).toBe(existingRectangle.id);
});

test('the next touch-only tap on an existing mark is not a completion duplicate', () => {
  const f = mountCanvas('ellipse', [existingRectangle]);
  rectangleAndEllipseHits(f.stage);
  f.pointer('pointerdown', 200, 200, false, 'touch');
  f.pointer('pointermove', 270, 270, true, 'touch');
  f.pointer('pointerup', 270, 270, true, 'touch');
  expect(f.selected()).toBe(f.saved()[1].id);
  vi.advanceTimersByTime(Konva.dblClickWindow + 1);
  f.touch('touchstart', 180, 200);
  f.touch('touchend', 180, 200);
  expect(f.selected()).toBe(existingRectangle.id);
});

test.each(['text', 'callout'] as const)(
  '%s created over a mark stays selected through pointerclick, tap and Enter',
  (tool) => {
    const f = mountCanvas(tool, [existingRectangle]);
    rectangleAndEllipseHits(f.stage);
    act(() => {
      f.pointer('pointerdown', 200, 200, false, 'touch');
      f.touch('touchstart', 200, 200);
    });
    f.pointer('pointerup', 200, 200, false, 'touch');
    f.touch('touchend', 200, 200);
    const pendingId = f.selected();
    expect(pendingId).not.toBeNull();
    expect(pendingId).not.toBe(existingRectangle.id);
    const editor = screen.getByRole('textbox', { name: 'Edit annotation text' });
    expect(document.activeElement).toBe(editor);
    expect(f.saved()).toEqual([existingRectangle]);
    fireEvent.change(editor, { target: { value: 'New note over a mark' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(f.saved()[1]).toMatchObject({ id: pendingId, text: 'New note over a mark' });
    expect(f.selected()).toBe(pendingId);
    vi.advanceTimersByTime(Konva.dblClickWindow + 1);
    f.pointer('pointerdown', 600, 400);
    f.pointer('pointerup', 600, 400);
    expect(f.selected()).toBeNull();
  },
);

test('later double clicks still create text and reopen an existing editor for Enter or Escape', () => {
  const f = mountCanvas('select');
  for (let click = 0; click < 2; click++) {
    f.pointer('pointerdown', 200, 200);
    f.pointer('pointerup', 200, 200);
  }
  let editor = screen.getByRole('textbox', { name: 'Edit annotation text' });
  fireEvent.change(editor, { target: { value: 'Original text' } });
  fireEvent.keyDown(editor, { key: 'Enter' });
  const note = f.saved()[0];
  expect(f.selected()).toBe(note.id);
  // Target the note's actual text child; its commonProps handlers live on the parent Group.
  const group = f.stage.findOne(`#${note.id}`) as Konva.Group;
  vi.spyOn(f.stage, 'getIntersection').mockReturnValue(group.findOne('Text') as Konva.Text);
  for (const key of ['Escape', 'Enter']) {
    vi.advanceTimersByTime(Konva.dblClickWindow + 1);
    for (let click = 0; click < 2; click++) {
      f.pointer('pointerdown', 200, 200);
      f.pointer('pointerup', 200, 200);
    }
    editor = screen.getByRole('textbox', { name: 'Edit annotation text' });
    fireEvent.change(editor, { target: { value: 'Edited text' } });
    fireEvent.keyDown(editor, { key });
    expect(f.saved()).toHaveLength(1);
    expect(f.saved()[0].text).toBe(key === 'Escape' ? 'Original text' : 'Edited text');
  }
});
