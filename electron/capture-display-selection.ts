import type { CaptureDisplay } from '../src/shared/capture.js';

function sameCaptureGeometry(left: CaptureDisplay, right: CaptureDisplay): boolean {
  return (
    left.id === right.id &&
    left.scaleFactor === right.scaleFactor &&
    left.bounds.x === right.bounds.x &&
    left.bounds.y === right.bounds.y &&
    left.bounds.width === right.bounds.width &&
    left.bounds.height === right.bounds.height
  );
}

/** Display order is irrelevant, but every captured display must still exist with identical geometry. */
export function captureDisplaysHaveStableGeometry(
  captured: readonly CaptureDisplay[],
  current: readonly CaptureDisplay[],
): boolean {
  return (
    captured.length === current.length &&
    captured.every((display) => {
      const match = current.find((candidate) => candidate.id === display.id);
      return Boolean(match && sameCaptureGeometry(display, match));
    })
  );
}

/**
 * Capture every snapshotted display, then verify the complete desktop geometry.
 * A display add/remove, move, resize, or DPI change fails closed.
 */
export async function captureDisplaysWithStableGeometry<T>(
  displays: readonly CaptureDisplay[],
  capture: (display: CaptureDisplay) => Promise<T>,
  currentDisplays: () => readonly CaptureDisplay[],
): Promise<T[] | null> {
  if (!displays.length) return null;
  const captures = await Promise.all(displays.map((display) => capture(display)));
  return captureDisplaysHaveStableGeometry(displays, currentDisplays()) ? captures : null;
}

/** Single-display helper retained for the capability probe and non-Windows evidence. */
export async function captureDisplayWithStableGeometry<T>(
  display: CaptureDisplay,
  capture: (display: CaptureDisplay) => Promise<T>,
  currentDisplays: () => readonly CaptureDisplay[],
): Promise<T | null> {
  const result = await capture(display);
  const current = currentDisplays().find((candidate) => candidate.id === display.id);
  return current && sameCaptureGeometry(display, current) ? result : null;
}
