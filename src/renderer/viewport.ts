export interface Viewport {
  x: number;
  y: number;
  scale: number;
}
export function zoomAt(viewport: Viewport, point: { x: number; y: number }, factor: number): Viewport {
  const scale = Math.max(0.02, Math.min(8, viewport.scale * factor));
  return {
    scale,
    x: point.x - ((point.x - viewport.x) * scale) / viewport.scale,
    y: point.y - ((point.y - viewport.y) * scale) / viewport.scale,
  };
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ViewportBounds extends ViewportSize {
  x: number;
  y: number;
}

/** Scales the bounds down to fit the canvas (never above 100%) and centres them, leaving room for canvas chrome. */
export function fitViewport(size: ViewportSize, bounds: ViewportBounds): Viewport {
  const scale = Math.max(
    0.02,
    Math.min((size.width - 64) / bounds.width, (size.height - 96) / bounds.height, 1),
  );
  return {
    x: (size.width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (size.height - bounds.height * scale) / 2 - bounds.y * scale,
    scale,
  };
}

/** Keeps the zoom and the image point at the canvas centre when the canvas changes size. */
export function recentreViewport(viewport: Viewport, previous: ViewportSize, next: ViewportSize): Viewport {
  return {
    ...viewport,
    x: viewport.x + (next.width - previous.width) / 2,
    y: viewport.y + (next.height - previous.height) / 2,
  };
}

/**
 * The viewport after the screenshot, canvas size or source bounds changed. Refits unless the user's
 * adjusted view of the same screenshot should be preserved; then the zoom and centred point survive.
 */
export function viewportForLayoutChange(
  current: Viewport,
  previousSize: ViewportSize | null,
  nextSize: ViewportSize,
  bounds: ViewportBounds,
  preserve: boolean,
): Viewport {
  if (!previousSize || !preserve) return fitViewport(nextSize, bounds);
  return recentreViewport(current, previousSize, nextSize);
}
