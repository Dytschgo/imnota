import type { Annotation } from '../../shared/types';

export interface NudgeDelta {
  x: number;
  y: number;
}

export const NUDGE_STEP = 1;
export const NUDGE_LARGE_STEP = 10;

/** Image-pixel offset for an arrow key, or null for any other key. */
export function nudgeDeltaForKey(key: string, large: boolean): NudgeDelta | null {
  const step = large ? NUDGE_LARGE_STEP : NUDGE_STEP;
  if (key === 'ArrowLeft') return { x: -step, y: 0 };
  if (key === 'ArrowRight') return { x: step, y: 0 };
  if (key === 'ArrowUp') return { x: 0, y: -step };
  if (key === 'ArrowDown') return { x: 0, y: step };
  return null;
}

/** Moves one annotation; returns the same array when the annotation does not exist. */
export function nudgeAnnotation(annotations: Annotation[], id: string, delta: NudgeDelta): Annotation[] {
  if (!annotations.some((annotation) => annotation.id === id)) return annotations;
  return annotations.map((annotation) =>
    annotation.id === id
      ? { ...annotation, x: annotation.x + delta.x, y: annotation.y + delta.y }
      : annotation,
  );
}

/** Annotations reachable from the keyboard, in the order they are stacked on the canvas. */
export function keyboardSelectionOrder(annotations: Annotation[]): Annotation[] {
  return annotations
    .map((annotation, index) => ({ annotation, index }))
    .filter(({ annotation }) => annotation.kind !== 'crop')
    .sort((left, right) => left.annotation.zIndex - right.annotation.zIndex || left.index - right.index)
    .map(({ annotation }) => annotation);
}

/**
 * The annotation Tab (direction 1) or Shift+Tab (direction -1) selects next. Returns null once the
 * selection moves past either end, so focus can leave the canvas instead of being trapped in it.
 */
export function nextKeyboardSelection(
  annotations: Annotation[],
  selectedId: string | null,
  direction: 1 | -1,
): string | null {
  const order = keyboardSelectionOrder(annotations);
  if (!order.length) return null;
  const current = order.findIndex((annotation) => annotation.id === selectedId);
  if (current < 0) return (direction === 1 ? order[0] : order.at(-1))!.id;
  return order[current + direction]?.id ?? null;
}

const KIND_LABELS: Partial<Record<Annotation['kind'], string>> = {
  'rounded-rectangle': 'Rounded rectangle',
  pen: 'Freehand stroke',
  blur: 'Redaction',
  pixelate: 'Pixelation',
  text: 'Text note',
};

function kindLabel(annotation: Annotation): string {
  if (annotation.kind === 'step') return `Step ${annotation.stepNumber ?? 1}`;
  const label = KIND_LABELS[annotation.kind] ?? annotation.kind;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Text alternative for the selected annotation, announced by the canvas live region. */
export function describeSelectedAnnotation(annotations: Annotation[], selectedId: string | null): string {
  const order = keyboardSelectionOrder(annotations);
  const index = order.findIndex((annotation) => annotation.id === selectedId);
  const annotation = order[index];
  if (!annotation) return '';
  const text = annotation.text?.trim().replace(/\s+/g, ' ');
  const label = text
    ? `${kindLabel(annotation)} “${text.length > 80 ? `${text.slice(0, 79)}…` : text}”`
    : kindLabel(annotation);
  return `${label} selected, ${index + 1} of ${order.length}, at ${Math.round(annotation.x)}, ${Math.round(annotation.y)}`;
}
