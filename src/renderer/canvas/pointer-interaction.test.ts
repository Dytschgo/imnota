import Konva from 'konva';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  captureContentPointer,
  finalizeAnnotationDrag,
  releaseContentPointer,
  type ActiveAnnotationDrag,
} from './pointer-interaction';

const stages: Konva.Stage[] = [];

afterEach(() => {
  for (const stage of stages.splice(0)) stage.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function createStage(): Konva.Stage {
  const canvas = document.createElement('canvas');
  const contextValues: Record<PropertyKey, unknown> = { canvas };
  const context = new Proxy(contextValues, {
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
  const container = document.createElement('div');
  document.body.append(container);
  const stage = new Konva.Stage({ container, width: 240, height: 160 });
  stages.push(stage);
  return stage;
}

function installDomPointerCapture(content: HTMLDivElement) {
  const captured = new Set<number>();
  const setPointerCapture = vi.fn((pointerId: number) => captured.add(pointerId));
  const hasPointerCapture = vi.fn((pointerId: number) => captured.has(pointerId));
  const releasePointerCapture = vi.fn((pointerId: number) => captured.delete(pointerId));
  Object.defineProperties(content, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    hasPointerCapture: { configurable: true, value: hasPointerCapture },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
  });
  return { captured, setPointerCapture, hasPointerCapture, releasePointerCapture };
}

function dispatchPointer(
  content: HTMLDivElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  pointerId: number,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 40,
    clientY: 40,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: 'mouse' },
  });
  content.dispatchEvent(event);
}

describe('pointer interaction lifecycle', () => {
  test('real Konva blank-canvas pointers retain move, up, click, and double-click semantics', () => {
    const stage = createStage();
    const capture = installDomPointerCapture(stage.content);
    const received = { move: 0, up: 0, click: 0, doubleClick: 0 };
    stage.on('pointerdown.capture-test', (event) => {
      captureContentPointer(stage.content, event.evt.pointerId);
    });
    stage.on('pointermove.capture-test', () => {
      received.move += 1;
    });
    stage.on('pointerup.capture-test', (event) => {
      received.up += 1;
      releaseContentPointer(stage.content, event.evt.pointerId);
    });
    stage.on('pointerclick.capture-test', () => {
      received.click += 1;
    });
    stage.on('pointerdblclick.capture-test', () => {
      received.doubleClick += 1;
    });

    dispatchPointer(stage.content, 'pointerdown', 23);
    expect(capture.captured.has(23)).toBe(true);
    expect(stage.hasPointerCapture(23)).toBe(false);
    dispatchPointer(stage.content, 'pointermove', 23);
    dispatchPointer(stage.content, 'pointerup', 23);
    dispatchPointer(stage.content, 'pointerdown', 23);
    dispatchPointer(stage.content, 'pointerup', 23);

    expect(received).toEqual({ move: 1, up: 2, click: 2, doubleClick: 1 });
    expect(capture.captured.size).toBe(0);
    expect(capture.setPointerCapture).toHaveBeenCalledTimes(2);
    expect(capture.releasePointerCapture).toHaveBeenCalledTimes(2);
  });

  test('real Konva annotation hit target remains the pointer-up and click target', () => {
    const stage = createStage();
    const capture = installDomPointerCapture(stage.content);
    const annotation = new Konva.Rect({ id: 'annotation', width: 80, height: 50 });
    vi.spyOn(annotation, 'getStage').mockReturnValue(stage);
    vi.spyOn(stage, 'getIntersection').mockReturnValue(annotation);
    const pointerUp = vi.fn();
    const pointerClick = vi.fn();
    annotation.on('pointerdown.capture-test', (event) => {
      captureContentPointer(stage.content, event.evt.pointerId);
    });
    annotation.on('pointerup.capture-test', (event) => {
      pointerUp();
      releaseContentPointer(stage.content, event.evt.pointerId);
    });
    annotation.on('pointerclick.capture-test', pointerClick);

    dispatchPointer(stage.content, 'pointerdown', 31);
    expect(capture.captured.has(31)).toBe(true);
    expect(stage.hasPointerCapture(31)).toBe(false);
    dispatchPointer(stage.content, 'pointerup', 31);

    expect(pointerUp).toHaveBeenCalledOnce();
    expect(pointerClick).toHaveBeenCalledOnce();
    expect(capture.captured.size).toBe(0);
  });

  test.each(['window blur', 'lostpointercapture'])(
    '%s cleanup stops and persists a drag exactly once',
    () => {
      const persist = vi.fn();
      const node = {
        x: () => 140,
        y: () => 90,
        position: vi.fn(),
        getLayer: () => null,
        isDragging: () => true,
        stopDrag: vi.fn(),
      };
      const drag: ActiveAnnotationDrag = {
        id: 'ellipse',
        kind: 'ellipse',
        width: 40,
        height: 20,
        node,
        finalized: false,
      };

      expect(finalizeAnnotationDrag(drag, persist)).toBe(true);
      expect(finalizeAnnotationDrag(drag, persist)).toBe(false);
      expect(node.stopDrag).toHaveBeenCalledOnce();
      expect(persist).toHaveBeenCalledOnce();
      expect(persist).toHaveBeenCalledWith('ellipse', { x: 120, y: 80 });
    },
  );
});
