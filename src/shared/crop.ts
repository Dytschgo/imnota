import type { Annotation } from './types';

/** The last crop wins; crop is axis-aligned and never changes the original. */
export function exportBounds(width: number, height: number, annotations: Annotation[]) {
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
