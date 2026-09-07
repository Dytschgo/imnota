import type { Annotation } from './types';
import {
  NOTE_BADGE_GAP,
  NOTE_BADGE_HEIGHT,
  noteBadgeWidth,
  textAnnotationLayout,
  type TextWidthMeasurer,
} from './annotation-geometry';
import { isTextAnnotation, textAnnotationNoteNumbers } from './annotation-order';

export interface ImageBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const EXPORT_SAFETY_MARGIN = 32;

/** The last crop wins; crop is axis-aligned and never changes the original. */
export function exportBounds(width: number, height: number, annotations: readonly Annotation[]): ImageBounds {
  const crop = [...annotations].reverse().find((annotation) => annotation.kind === 'crop');
  if (!crop) return { x: 0, y: 0, width, height };
  const x = Math.min(width - 1, Math.max(0, Math.floor(crop.x)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(crop.y)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.floor(crop.width ?? width))),
    height: Math.max(1, Math.min(height - y, Math.floor(crop.height ?? height))),
  };
}

function padded(bounds: ImageBounds, amount: number): ImageBounds {
  return {
    x: bounds.x - amount,
    y: bounds.y - amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2,
  };
}

function boundsFromPoints(points: Array<{ x: number; y: number }>): ImageBounds {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function rotatedPathPoints(annotation: Annotation, points: number[]): Array<{ x: number; y: number }> {
  const radians = ((annotation.rotation ?? 0) * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const absolute = [];
  for (let index = 0; index < points.length; index += 2) {
    const x = points[index];
    const y = points[index + 1] ?? 0;
    absolute.push({
      x: annotation.x + x * cosine - y * sine,
      y: annotation.y + x * sine + y * cosine,
    });
  }
  return absolute;
}

function rotatedRectangle(x: number, y: number, width: number, height: number, degrees = 0): ImageBounds {
  if (!degrees) return { x, y, width, height };
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return boundsFromPoints(
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ].map((point) => ({
      x: x + point.x * cosine - point.y * sine,
      y: y + point.x * sine + point.y * cosine,
    })),
  );
}

function ellipseBounds(annotation: Annotation, width: number, height: number): ImageBounds {
  const radians = ((annotation.rotation ?? 0) * Math.PI) / 180;
  const radiusX = width / 2;
  const radiusY = height / 2;
  const halfWidth = Math.sqrt((radiusX * Math.cos(radians)) ** 2 + (radiusY * Math.sin(radians)) ** 2);
  const halfHeight = Math.sqrt((radiusX * Math.sin(radians)) ** 2 + (radiusY * Math.cos(radians)) ** 2);
  return {
    x: annotation.x + radiusX - halfWidth,
    y: annotation.y + radiusY - halfHeight,
    width: halfWidth * 2,
    height: halfHeight * 2,
  };
}

export function annotationExportBounds(
  annotation: Annotation,
  noteNumber?: number,
  measureWidth?: TextWidthMeasurer,
): ImageBounds | null {
  if (annotation.kind === 'crop') return null;
  if ((annotation.kind === 'text' || annotation.kind === 'callout') && !isTextAnnotation(annotation))
    return null;
  const strokePadding = Math.max(1, (annotation.strokeWidth ?? 4) / 2);
  if (annotation.kind === 'arrow' || annotation.kind === 'line' || annotation.kind === 'pen') {
    const points = annotation.points ?? [0, 0, annotation.width ?? 10, annotation.height ?? 10];
    return padded(
      boundsFromPoints(rotatedPathPoints(annotation, points)),
      annotation.kind === 'arrow' ? Math.max(12, strokePadding) : strokePadding,
    );
  }

  const width = Math.max(1, Math.abs(annotation.width ?? 20));
  const height = Math.max(1, Math.abs(annotation.height ?? 20));
  if (annotation.kind === 'ellipse') return padded(ellipseBounds(annotation, width, height), strokePadding);
  if (annotation.kind === 'text' || annotation.kind === 'callout') {
    const layout = textAnnotationLayout(annotation, measureWidth);
    const badgeWidth = noteNumber ? NOTE_BADGE_GAP + noteBadgeWidth(noteNumber) : 0;
    return padded(
      rotatedRectangle(
        annotation.x,
        annotation.y,
        layout.width + badgeWidth,
        Math.max(layout.height, noteNumber ? NOTE_BADGE_HEIGHT : 0),
        annotation.rotation,
      ),
      annotation.kind === 'text' ? 3 : 1,
    );
  }
  return padded(
    rotatedRectangle(annotation.x, annotation.y, width, height, annotation.rotation),
    strokePadding,
  );
}

function union(left: ImageBounds, right: ImageBounds): ImageBounds {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

/**
 * Keeps the source in its original world coordinates while expanding the final
 * white output surface around crop-visible source and all rendered annotations.
 */
export function expandedExportBounds(
  width: number,
  height: number,
  annotations: readonly Annotation[],
  margin = EXPORT_SAFETY_MARGIN,
  measureWidth?: TextWidthMeasurer,
): ImageBounds {
  const source = exportBounds(width, height, annotations);
  const noteNumbers = textAnnotationNoteNumbers(annotations);
  let content = source;
  for (const annotation of annotations) {
    const bounds = annotationExportBounds(annotation, noteNumbers.get(annotation.id), measureWidth);
    if (bounds) content = union(content, bounds);
  }
  const x = Math.floor(content.x - margin);
  const y = Math.floor(content.y - margin);
  const right = Math.ceil(content.x + content.width + margin);
  const bottom = Math.ceil(content.y + content.height + margin);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}
