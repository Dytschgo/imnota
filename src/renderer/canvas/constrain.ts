import type { AnnotationKind } from '../../shared/types';

export interface Delta {
  x: number;
  y: number;
}

const LINE_SNAP_RADIANS = Math.PI / 4;

/** Kinds whose drawn box becomes a square (or circle) while Shift is held. Crop keeps its free aspect. */
const BOX_CONSTRAINED_KINDS: ReadonlySet<AnnotationKind> = new Set<AnnotationKind>([
  'rectangle',
  'rounded-rectangle',
  'ellipse',
  'highlight',
  'blur',
  'pixelate',
]);

/** Snaps a line's end offset to the nearest 45° direction, keeping the end close to the pointer. */
export function constrainLineDelta(delta: Delta): Delta {
  if (delta.x === 0 && delta.y === 0) return delta;
  const step = Math.round(Math.atan2(delta.y, delta.x) / LINE_SNAP_RADIANS);
  if (step % 2 === 0) return step % 4 === 0 ? { x: delta.x, y: 0 } : { x: 0, y: delta.y };
  // Project the pointer onto the diagonal so both components have exactly the same magnitude.
  const length = (Math.abs(delta.x) + Math.abs(delta.y)) / 2;
  return { x: Math.sign(delta.x) * length, y: Math.sign(delta.y) * length };
}

/** Makes a dragged box square using its longer side, preserving the drag direction on each axis. */
export function constrainBoxDelta(delta: Delta): Delta {
  const side = Math.max(Math.abs(delta.x), Math.abs(delta.y));
  return { x: (delta.x < 0 ? -1 : 1) * side, y: (delta.y < 0 ? -1 : 1) * side };
}

/** The draft's end offset from its origin, constrained for its kind only while the modifier is held. */
export function constrainDraftDelta(kind: AnnotationKind, delta: Delta, constrain: boolean): Delta {
  if (!constrain) return delta;
  if (kind === 'arrow' || kind === 'line') return constrainLineDelta(delta);
  if (BOX_CONSTRAINED_KINDS.has(kind)) return constrainBoxDelta(delta);
  return delta;
}
