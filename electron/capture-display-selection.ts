import type { CaptureDisplay, CaptureDisplayOption } from '../src/shared/capture.js';

function positionRelativeToPrimary(display: CaptureDisplay, primary: CaptureDisplay): string {
  if (display.id === primary.id) return 'Primary display';
  const horizontal =
    display.bounds.x + display.bounds.width <= primary.bounds.x
      ? 'left'
      : display.bounds.x >= primary.bounds.x + primary.bounds.width
        ? 'right'
        : '';
  const vertical =
    display.bounds.y + display.bounds.height <= primary.bounds.y
      ? 'above'
      : display.bounds.y >= primary.bounds.y + primary.bounds.height
        ? 'below'
        : '';
  if (horizontal && vertical) return `${vertical[0]!.toUpperCase()}${vertical.slice(1)} and ${horizontal}`;
  if (horizontal) return `${horizontal[0]!.toUpperCase()}${horizontal.slice(1)} of primary`;
  if (vertical) return `${vertical[0]!.toUpperCase()}${vertical.slice(1)} primary`;
  return 'Overlapping primary';
}

/** Stable chooser order with the primary display first and desktop geometry after it. */
export function captureDisplayOptions(
  displays: readonly CaptureDisplay[],
  primaryDisplayId: number,
): CaptureDisplayOption[] {
  const primary = displays.find((display) => display.id === primaryDisplayId);
  if (!primary) return [];
  return [...displays]
    .sort((left, right) => {
      if (left.id === primary.id) return -1;
      if (right.id === primary.id) return 1;
      return left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x || left.id - right.id;
    })
    .map((display) => ({
      id: display.id,
      bounds: { ...display.bounds },
      scaleFactor: display.scaleFactor,
      primary: display.id === primary.id,
      position: positionRelativeToPrimary(display, primary),
    }));
}

/** Resolve only the requested Windows display. A missing/stale id never falls back. */
export function selectedCaptureDisplay(
  displays: readonly CaptureDisplay[],
  selectedDisplayId: number | undefined,
): CaptureDisplay | null {
  if (displays.length === 1 && selectedDisplayId === undefined) return displays[0]!;
  if (selectedDisplayId === undefined) return null;
  return displays.find((display) => display.id === selectedDisplayId) ?? null;
}

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

/**
 * Capture the selected display, then verify its identity and DIP-to-pixel
 * geometry immediately before the caller creates an overlay from the saved
 * snapshot. A display removal, move, resize, or DPI change fails closed.
 */
export async function captureDisplayWithStableGeometry<T>(
  selectedDisplay: CaptureDisplay,
  capture: (display: CaptureDisplay) => Promise<T>,
  currentDisplays: () => readonly CaptureDisplay[],
): Promise<T | null> {
  const result = await capture(selectedDisplay);
  const current = currentDisplays().find((display) => display.id === selectedDisplay.id);
  return current && sameCaptureGeometry(selectedDisplay, current) ? result : null;
}
