import type { AnnotationKind } from '../../shared/types';

export interface PointerCaptureStage {
  setPointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
  releaseCapture(pointerId: number): void;
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

/** Uses Konva's capture map and stage.content instead of the non-listening outer container. */
export function captureStagePointer(stage: PointerCaptureStage, pointerId: number): boolean {
  stage.setPointerCapture(pointerId);
  return stage.hasPointerCapture(pointerId);
}

export function releaseStagePointer(stage: PointerCaptureStage, pointerId: number): void {
  if (stage.hasPointerCapture(pointerId)) stage.releaseCapture(pointerId);
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
