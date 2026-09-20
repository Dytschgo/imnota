/** CSS/DIP rectangle relative to one display. */
export interface CaptureRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureDisplay {
  id: number;
  bounds: CaptureRectangle;
  scaleFactor: number;
}

/** Non-pixel display metadata shown before a Windows region capture begins. */
export interface CaptureDisplayOption extends CaptureDisplay {
  position: string;
}

export const CAPTURE_OVERLAY_MODES = ['region', 'window', 'display'] as const;
export type CaptureOverlayMode = (typeof CAPTURE_OVERLAY_MODES)[number];

/** Shown when Window mode is selected but the OS did not identify any windows. */
export const WINDOW_CAPTURE_UNAVAILABLE_MESSAGE =
  'Imnota could not identify windows on this computer. Use Region to select an area.';

/** Last successful region from this app session. Bounds are DIP, relative to that display. */
export interface LastCaptureRegion {
  displayId: number;
  bounds: CaptureRectangle;
}

export const LAST_CAPTURE_REGION_UNAVAILABLE_MESSAGE =
  'Capture a region first. Repeat last region uses the last successful region from this session.';

export const LAST_CAPTURE_REGION_DISPLAY_GONE_MESSAGE =
  'The display used for the last region is no longer connected. Capture a new region, or reconnect that display.';

export const LAST_CAPTURE_REGION_INVALID_MESSAGE =
  'The last captured region no longer fits that display. Capture a new region.';

export const MAX_CAPTURE_DIMENSION = 16_384;
/** 8K fits; prohibit decoded images that would require excessive native memory. */
export const MAX_CAPTURE_PIXELS = 64_000_000;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

export function normalizeCaptureRectangle(
  raw: CaptureRectangle,
  displaySize: Pick<CaptureRectangle, 'width' | 'height'>,
): CaptureRectangle | null {
  if (![raw.x, raw.y, raw.width, raw.height, displaySize.width, displaySize.height].every(finite))
    return null;
  if (displaySize.width <= 0 || displaySize.height <= 0 || raw.width <= 0 || raw.height <= 0) return null;
  const left = Math.min(Math.max(raw.x, 0), displaySize.width);
  const top = Math.min(Math.max(raw.y, 0), displaySize.height);
  const right = Math.min(Math.max(raw.x + raw.width, 0), displaySize.width);
  const bottom = Math.min(Math.max(raw.y + raw.height, 0), displaySize.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Map DIP selection coordinates through the actual native thumbnail dimensions. */
export function captureRectangleToImagePixels(
  selection: CaptureRectangle,
  displaySize: Pick<CaptureRectangle, 'width' | 'height'>,
  imageSize: Pick<CaptureRectangle, 'width' | 'height'>,
): CaptureRectangle | null {
  const normalized = normalizeCaptureRectangle(selection, displaySize);
  if (
    !normalized ||
    !finite(imageSize.width) ||
    !finite(imageSize.height) ||
    imageSize.width < 1 ||
    imageSize.height < 1 ||
    imageSize.width > MAX_CAPTURE_DIMENSION ||
    imageSize.height > MAX_CAPTURE_DIMENSION ||
    imageSize.width * imageSize.height > MAX_CAPTURE_PIXELS
  )
    return null;
  const scaleX = imageSize.width / displaySize.width;
  const scaleY = imageSize.height / displaySize.height;
  const left = Math.floor(normalized.x * scaleX);
  const top = Math.floor(normalized.y * scaleY);
  const right = Math.ceil((normalized.x + normalized.width) * scaleX);
  const bottom = Math.ceil((normalized.y + normalized.height) * scaleY);
  const x = Math.min(Math.max(left, 0), imageSize.width);
  const y = Math.min(Math.max(top, 0), imageSize.height);
  const clampedRight = Math.min(Math.max(right, 0), imageSize.width);
  const clampedBottom = Math.min(Math.max(bottom, 0), imageSize.height);
  if (clampedRight <= x || clampedBottom <= y) return null;
  return { x, y, width: clampedRight - x, height: clampedBottom - y };
}
