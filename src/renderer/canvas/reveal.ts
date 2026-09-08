import type { Viewport } from '../viewport';

/** Center a search match, including annotations outside the original screenshot. */
export function viewportToReveal(
  bounds: { x: number; y: number; width: number; height: number },
  canvas: { width: number; height: number },
): Viewport {
  const scale = Math.max(
    0.02,
    Math.min(
      1,
      (canvas.width - 64) / Math.max(1, bounds.width),
      (canvas.height - 96) / Math.max(1, bounds.height),
    ),
  );
  return {
    scale,
    x: canvas.width / 2 - (bounds.x + bounds.width / 2) * scale,
    y: canvas.height / 2 - (bounds.y + bounds.height / 2) * scale,
  };
}
