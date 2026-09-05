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
