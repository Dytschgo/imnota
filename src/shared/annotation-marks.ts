import { normalizeAnnotationBounds } from './annotation-geometry';
import { textAnnotationNoteNumbers } from './annotation-order';
import type { Annotation } from './types';

function percent(value: number, total: number): string {
  const ratio = total > 0 && Number.isFinite(value) ? (value / total) * 100 : 0;
  return `${ratio.toFixed(1)}%`;
}

function formatPoint(x: number, y: number, image: { originalWidth: number; originalHeight: number }): string {
  return `${percent(x, image.originalWidth)},${percent(y, image.originalHeight)}`;
}

function pathEndpoints(annotation: Annotation): { fromX: number; fromY: number; toX: number; toY: number } {
  const points = annotation.points ?? [0, 0, annotation.width ?? 10, annotation.height ?? 10];
  const last = points.length >= 4 ? points.length - 2 - (points.length % 2) : 2;
  return {
    fromX: annotation.x + (points[0] ?? 0),
    fromY: annotation.y + (points[1] ?? 0),
    toX: annotation.x + (Number.isFinite(points[last]) ? points[last] : (annotation.width ?? 10)),
    toY: annotation.y + (Number.isFinite(points[last + 1]) ? points[last + 1] : (annotation.height ?? 10)),
  };
}

function pathBox(annotation: Annotation): { x: number; y: number; width: number; height: number } {
  const points = annotation.points;
  if (!points || points.length < 2) {
    const bounds = normalizeAnnotationBounds(annotation);
    return { x: bounds.x, y: bounds.y, width: bounds.width ?? 0, height: bounds.height ?? 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x = annotation.x + points[index];
    const y = annotation.y + points[index + 1];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Crop is an image operation; redaction coordinates would outline secrets. */
function formatMarkLine(
  annotation: Annotation,
  image: { originalWidth: number; originalHeight: number },
  noteNumber: number | undefined,
): string | null {
  if (annotation.kind === 'crop' || annotation.kind === 'blur' || annotation.kind === 'pixelate') return null;
  if ((annotation.kind === 'text' || annotation.kind === 'callout') && noteNumber === undefined) return null;
  const id = `\`${annotation.id}\``;
  if (annotation.kind === 'arrow' || annotation.kind === 'line') {
    const { fromX, fromY, toX, toY } = pathEndpoints(annotation);
    return `${annotation.kind} ${id} from ${formatPoint(fromX, fromY, image)} to ${formatPoint(toX, toY, image)}`;
  }
  if (annotation.kind === 'step') {
    return `step ${id} number ${annotation.stepNumber ?? 1} at ${formatPoint(annotation.x, annotation.y, image)}`;
  }
  const box = annotation.kind === 'pen' ? pathBox(annotation) : normalizeAnnotationBounds(annotation);
  const note = noteNumber === undefined ? '' : ` note ${noteNumber}`;
  return `${annotation.kind} ${id}${note} at ${formatPoint(box.x, box.y, image)} ${percent(box.width ?? 0, image.originalWidth)}×${percent(box.height ?? 0, image.originalHeight)}`;
}

export function annotationMarkListItems(
  annotations: readonly Annotation[],
  image: { originalWidth: number; originalHeight: number },
): string[] {
  const noteNumbers = textAnnotationNoteNumbers(annotations);
  return annotations.flatMap((annotation) => {
    const line = formatMarkLine(annotation, image, noteNumbers.get(annotation.id));
    return line ? [`- ${line}`] : [];
  });
}
