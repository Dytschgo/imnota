import type {
  CaptureDisplay,
  CaptureOverlayMode,
  CaptureRectangle,
  LastCaptureRegion,
} from '../src/shared/capture.js';
import {
  LAST_CAPTURE_REGION_DISPLAY_GONE_MESSAGE,
  LAST_CAPTURE_REGION_INVALID_MESSAGE,
  LAST_CAPTURE_REGION_UNAVAILABLE_MESSAGE,
} from '../src/shared/capture.js';
import { captureDisplaysHaveStableGeometry } from './capture-display-selection.js';

export type LastCaptureRegionFailure = 'unavailable' | 'display-gone' | 'region-invalid';
export type LastCaptureRegionResolution =
  | { ok: true; displays: CaptureDisplay[]; selection: CaptureRectangle; remembered: LastCaptureRegion }
  | { ok: false; kind: LastCaptureRegionFailure; message: string };

function cloneRegion(region: LastCaptureRegion): LastCaptureRegion {
  return {
    bounds: { ...region.bounds },
    displays: region.displays.map((display) => ({ ...display, bounds: { ...display.bounds } })),
  };
}

function intersects(left: CaptureRectangle, right: CaptureRectangle): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

/** Keep the exact desktop geometry so repeat cannot silently crop a moved or disconnected screen. */
export function lastCaptureRegionFromSelection(
  displays: readonly CaptureDisplay[],
  selection: CaptureRectangle,
  mode: CaptureOverlayMode,
): LastCaptureRegion | null {
  if (
    mode !== 'region' ||
    !displays.length ||
    ![selection.x, selection.y, selection.width, selection.height].every(Number.isFinite) ||
    selection.width <= 0 ||
    selection.height <= 0 ||
    !displays.some((display) => intersects(display.bounds, selection))
  )
    return null;
  return cloneRegion({ bounds: selection, displays: [...displays] });
}

export function lastCaptureRegionForDisplay(
  remembered: LastCaptureRegion | null,
  display: CaptureDisplay,
): CaptureRectangle | null {
  if (!remembered || !intersects(remembered.bounds, display.bounds)) return null;
  return { ...remembered.bounds };
}

export function resolveLastCaptureRegion(
  remembered: LastCaptureRegion | null,
  displays: readonly CaptureDisplay[],
): LastCaptureRegionResolution {
  if (!remembered)
    return { ok: false, kind: 'unavailable', message: LAST_CAPTURE_REGION_UNAVAILABLE_MESSAGE };
  if (remembered.displays.some((display) => !displays.some((current) => current.id === display.id)))
    return { ok: false, kind: 'display-gone', message: LAST_CAPTURE_REGION_DISPLAY_GONE_MESSAGE };
  if (!captureDisplaysHaveStableGeometry(remembered.displays, displays))
    return { ok: false, kind: 'region-invalid', message: LAST_CAPTURE_REGION_INVALID_MESSAGE };
  return {
    ok: true,
    displays: [...displays],
    selection: { ...remembered.bounds },
    remembered: cloneRegion(remembered),
  };
}

export class LastCaptureRegionMemory {
  private last: LastCaptureRegion | null = null;

  peek(): LastCaptureRegion | null {
    return this.last ? cloneRegion(this.last) : null;
  }

  remember(displays: readonly CaptureDisplay[], selection: CaptureRectangle, mode: CaptureOverlayMode): void {
    const next = lastCaptureRegionFromSelection(displays, selection, mode);
    if (next) this.last = next;
  }

  resolve(displays: readonly CaptureDisplay[]): LastCaptureRegionResolution {
    return resolveLastCaptureRegion(this.last, displays);
  }
}
