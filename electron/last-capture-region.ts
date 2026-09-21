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
  normalizeCaptureRectangle,
} from '../src/shared/capture.js';

export type LastCaptureRegionFailure = 'unavailable' | 'display-gone' | 'region-invalid';

export type LastCaptureRegionResolution =
  | {
      ok: true;
      display: CaptureDisplay;
      selection: CaptureRectangle;
      remembered: LastCaptureRegion;
    }
  | { ok: false; kind: LastCaptureRegionFailure; message: string };

function sameRectangle(left: CaptureRectangle, right: CaptureRectangle): boolean {
  return (
    left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height
  );
}

function cloneRegion(region: LastCaptureRegion): LastCaptureRegion {
  return { displayId: region.displayId, bounds: { ...region.bounds } };
}

/** Convert a global DIP selection on one captured display into session memory. */
export function lastCaptureRegionFromSelection(
  display: CaptureDisplay,
  selection: CaptureRectangle,
  mode: CaptureOverlayMode,
): LastCaptureRegion | null {
  if (mode !== 'region') return null;
  const local = normalizeCaptureRectangle(
    {
      x: selection.x - display.bounds.x,
      y: selection.y - display.bounds.y,
      width: selection.width,
      height: selection.height,
    },
    display.bounds,
  );
  return local ? { displayId: display.id, bounds: local } : null;
}

export function lastCaptureRegionForDisplay(
  remembered: LastCaptureRegion | null,
  displayId: number,
): CaptureRectangle | null {
  return remembered && remembered.displayId === displayId ? { ...remembered.bounds } : null;
}

/**
 * Resolve the remembered region against the live display list. A missing id
 * never falls back to another connected display.
 */
export function resolveLastCaptureRegion(
  remembered: LastCaptureRegion | null,
  displays: readonly CaptureDisplay[],
): LastCaptureRegionResolution {
  if (!remembered)
    return { ok: false, kind: 'unavailable', message: LAST_CAPTURE_REGION_UNAVAILABLE_MESSAGE };
  const display = displays.find((candidate) => candidate.id === remembered.displayId);
  if (!display) return { ok: false, kind: 'display-gone', message: LAST_CAPTURE_REGION_DISPLAY_GONE_MESSAGE };
  const local = normalizeCaptureRectangle(remembered.bounds, display.bounds);
  if (!local || !sameRectangle(local, remembered.bounds))
    return { ok: false, kind: 'region-invalid', message: LAST_CAPTURE_REGION_INVALID_MESSAGE };
  return {
    ok: true,
    display,
    selection: {
      x: display.bounds.x + local.x,
      y: display.bounds.y + local.y,
      width: local.width,
      height: local.height,
    },
    remembered: cloneRegion(remembered),
  };
}

export class LastCaptureRegionMemory {
  private last: LastCaptureRegion | null = null;

  peek(): LastCaptureRegion | null {
    return this.last ? cloneRegion(this.last) : null;
  }

  remember(display: CaptureDisplay, selection: CaptureRectangle, mode: CaptureOverlayMode): void {
    const next = lastCaptureRegionFromSelection(display, selection, mode);
    if (next) this.last = next;
  }

  resolve(displays: readonly CaptureDisplay[]): LastCaptureRegionResolution {
    return resolveLastCaptureRegion(this.last, displays);
  }
}
