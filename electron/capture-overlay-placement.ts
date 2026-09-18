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
  if (platform === 'win32')
    return {
      ...bounds,
      fullscreen: false,
      fullscreenable: false,
      simpleFullscreen: false,
      roundedCorners: false,
    };
  return { ...bounds, fullscreen: true, fullscreenable: true, simpleFullscreen: platform === 'darwin' };
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
