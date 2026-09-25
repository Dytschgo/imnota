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

/** Fullscreen changes the macOS work area without changing the captured pixels. */
export function captureDisplayMetricsInvalidateSelection(changedMetrics: readonly string[]): boolean {
  return changedMetrics.length === 0 || changedMetrics.some((metric) => metric !== 'workArea');
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

/** Prepare every connected screen and reject changes to the full desktop during preparation. */
export async function captureAllDisplaysWithStableGeometry<T>(
  displays: readonly CaptureDisplay[],
  capture: (displays: readonly CaptureDisplay[]) => Promise<T>,
  currentDisplays: () => readonly CaptureDisplay[],
): Promise<T | null> {
  if (!displays.length) return null;
  const result = await capture(displays);
  return captureDisplaysHaveStableGeometry(displays, currentDisplays()) ? result : null;
}

/** Capture one display, then verify its identity and DIP-to-pixel geometry. */
export async function captureDisplayWithStableGeometry<T>(
  display: CaptureDisplay,
  capture: (display: CaptureDisplay) => Promise<T>,
  currentDisplays: () => readonly CaptureDisplay[],
): Promise<T | null> {
  const result = await capture(display);
  const current = currentDisplays().find((candidate) => candidate.id === display.id);
  return current && sameCaptureGeometry(display, current) ? result : null;
}
