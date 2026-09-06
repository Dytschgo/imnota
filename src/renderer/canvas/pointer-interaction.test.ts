import { describe, expect, test, vi } from 'vitest';
import {
  captureStagePointer,
  finalizeAnnotationDrag,
  releaseStagePointer,
  type ActiveAnnotationDrag,
} from './pointer-interaction';

describe('pointer interaction lifecycle', () => {
  test('captures through the Konva stage API and releases the same capture', () => {
    let captured: number | null = null;
    const stage = {
      setPointerCapture: vi.fn((pointerId: number) => {
        captured = pointerId;
      }),
      hasPointerCapture: vi.fn((pointerId: number) => captured === pointerId),
      releaseCapture: vi.fn((pointerId: number) => {
        if (captured === pointerId) captured = null;
      }),
    };

    expect(captureStagePointer(stage, 17)).toBe(true);
    expect(stage.setPointerCapture).toHaveBeenCalledWith(17);
    releaseStagePointer(stage, 17);
    expect(stage.releaseCapture).toHaveBeenCalledWith(17);
    expect(captured).toBeNull();
  });

  test('keeps captured pointer move and up events routed through stage content', () => {
    let captured: number | null = null;
    const content = new EventTarget();
    const received: string[] = [];
    const stage = {
      setPointerCapture: (pointerId: number) => {
        captured = pointerId;
      },
      hasPointerCapture: (pointerId: number) => captured === pointerId,
      releaseCapture: (pointerId: number) => {
        if (captured === pointerId) captured = null;
      },
    };
    const routeCapturedEvent = (type: string, pointerId: number) => {
      if (captured === pointerId) content.dispatchEvent(new Event(type));
    };

    content.addEventListener('pointermove', () => received.push('move'));
    content.addEventListener('pointerup', () => received.push('up'));

    captureStagePointer(stage, 23);
    routeCapturedEvent('pointermove', 23);
    routeCapturedEvent('pointerup', 23);
    releaseStagePointer(stage, 23);

    expect(received).toEqual(['move', 'up']);
    expect(captured).toBeNull();
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
