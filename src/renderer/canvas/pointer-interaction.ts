import type { AnnotationKind } from '../../shared/types';

export interface PointerCaptureContent {
  setPointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
}

export interface DraggableAnnotationNode {
  x(): number;
  y(): number;
  position(position: { x: number; y: number }): unknown;
  getLayer(): { batchDraw(): unknown } | null;
  isDragging(): boolean;
  stopDrag(event?: Event): void;
}

export interface ActiveAnnotationDrag {
  id: string;
  kind: AnnotationKind;
  width: number;
  height: number;
  node: DraggableAnnotationNode;
  finalized: boolean;
}

export interface DragPosition {
  x: number;
  y: number;
}

/** Capture on stage.content without changing Konva's shape hit/click capture map. */
export function captureContentPointer(content: PointerCaptureContent, pointerId: number): boolean {
  content.setPointerCapture(pointerId);
  return content.hasPointerCapture(pointerId);
}

export function releaseContentPointer(content: PointerCaptureContent, pointerId: number): void {
  if (content.hasPointerCapture(pointerId)) content.releasePointerCapture(pointerId);
}

/** Idempotently stops Konva drag state and persists the final source-world position once. */
export function finalizeAnnotationDrag(
  drag: ActiveAnnotationDrag,
  persist: (id: string, position: DragPosition) => void,
  event?: Event,
): boolean {
  if (drag.finalized) return false;
  drag.finalized = true;
  const position = {
    x: drag.node.x() - (drag.kind === 'ellipse' ? drag.width / 2 : 0),
    y: drag.node.y() - (drag.kind === 'ellipse' ? drag.height / 2 : 0),
  };
  if (drag.node.isDragging()) drag.node.stopDrag(event);
  persist(drag.id, position);
  return true;
}
