import type { CaptureRectangle } from '../src/shared/capture.js';

export type CaptureOverlayPlatform = 'win32' | 'darwin' | 'linux';

/**
 * Window-manager placement for the selection overlay.
 *
 * Windows ignores explicit `x`/`y` bounds when a BrowserWindow is constructed
 * with `fullscreen: true` and instead enters fullscreen on the primary display.
 * With two displays the overlay then opened on the wrong screen while the
 * captured pixels came from the display under the pointer. Frameless, always
 * on top, exact display bounds cover the display without fullscreen there.
 */
export function captureOverlayWindowOptions(
  displayBounds: CaptureRectangle,
  platform: CaptureOverlayPlatform | NodeJS.Platform,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  fullscreen: boolean;
  fullscreenable: boolean;
  simpleFullscreen: boolean;
  roundedCorners?: boolean;
} {
  const bounds = {
    x: Math.round(displayBounds.x),
    y: Math.round(displayBounds.y),
    width: Math.round(displayBounds.width),
    height: Math.round(displayBounds.height),
  };
  if (platform === 'win32' || platform === 'darwin')
    return {
      ...bounds,
      fullscreen: false,
      fullscreenable: false,
      simpleFullscreen: false,
      roundedCorners: false,
    };
  return { ...bounds, fullscreen: true, fullscreenable: true, simpleFullscreen: false };
}

/**
 * The overlay paints the already-captured still. A transparent window would
 * show the live desktop after hover menus collapse under the overlay.
 */
export function captureOverlayFreezeAppearance(): {
  transparent: false;
  hasShadow: false;
  backgroundColor: '#05080d';
} {
  return {
    transparent: false,
    hasShadow: false,
    backgroundColor: '#05080d',
  };
}

export const CAPTURE_DELAY_HUD_SIZE = { width: 288, height: 72 };

/** Small countdown chip; must not cover the display so hover menus can appear. */
export function captureDelayHudWindowOptions(displayBounds: CaptureRectangle): CaptureRectangle {
  const width = Math.min(CAPTURE_DELAY_HUD_SIZE.width, Math.max(Math.round(displayBounds.width), 1));
  const height = Math.min(CAPTURE_DELAY_HUD_SIZE.height, Math.max(Math.round(displayBounds.height), 1));
  return {
    x: Math.round(displayBounds.x + Math.max(0, (displayBounds.width - width) / 2)),
    y: Math.round(displayBounds.y + Math.min(16, Math.max(0, displayBounds.height - height))),
    width,
    height,
  };
}

/** The overlay must map its DIP coordinates 1:1 onto the captured display. */
export function overlayCoversDisplay(actual: CaptureRectangle, expected: CaptureRectangle): boolean {
  return (
    actual.x === expected.x &&
    actual.y === expected.y &&
    actual.width === expected.width &&
    actual.height === expected.height
  );
}
