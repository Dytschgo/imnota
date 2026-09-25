// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  captureOverlayFreezeAppearance,
  captureDelayHudWindowOptions,
  captureOverlayWindowOptions,
  overlayCoversDisplay,
} from './capture-overlay-placement.js';

const secondary = { x: 2560, y: -180, width: 1920, height: 1080 };

describe('capture overlay placement', () => {
  it('places the Windows overlay on the captured display without fullscreen', () => {
    expect(captureOverlayWindowOptions(secondary, 'win32')).toEqual({
      ...secondary,
      fullscreen: false,
      fullscreenable: false,
      simpleFullscreen: false,
      roundedCorners: false,
    });
  });

  it('places a left-of-primary 125% display at its DIP origin instead of the primary', () => {
    const left = { x: -3072, y: -216, width: 3072, height: 1728 };
    expect(captureOverlayWindowOptions(left, 'win32')).toEqual({
      ...left,
      fullscreen: false,
      fullscreenable: false,
      simpleFullscreen: false,
      roundedCorners: false,
    });
  });

  it('places a macOS overlay at the exact secondary display bounds', () => {
    expect(captureOverlayWindowOptions(secondary, 'darwin')).toEqual({
      ...secondary,
      fullscreen: false,
      fullscreenable: false,
      simpleFullscreen: false,
      roundedCorners: false,
    });
  });

  it('places a delay countdown on a chip, not a full-display overlay', () => {
    const hud = captureDelayHudWindowOptions(secondary);
    expect(hud).toEqual({ x: 3376, y: -164, width: 288, height: 72 });
    expect(overlayCoversDisplay(hud, secondary)).toBe(false);
    expect(hud.width).toBeLessThan(secondary.width);
    expect(hud.height).toBeLessThan(secondary.height);
  });

  it('rounds fractional DIP bounds from scaled displays', () => {
    expect(captureOverlayWindowOptions({ x: 1535.5, y: 0.4, width: 1279.6, height: 719.6 }, 'win32')).toEqual(
      expect.objectContaining({ x: 1536, y: 0, width: 1280, height: 720 }),
    );
  });

  it('rejects an overlay that landed on a different display or the work area', () => {
    expect(overlayCoversDisplay(secondary, secondary)).toBe(true);
    expect(overlayCoversDisplay({ ...secondary, x: 0, y: 0 }, secondary)).toBe(false);
    expect(overlayCoversDisplay({ ...secondary, height: 1040 }, secondary)).toBe(false);
  });

  it('uses an opaque window so the captured still covers live UI', () => {
    expect(captureOverlayFreezeAppearance()).toEqual({
      transparent: false,
      hasShadow: false,
      backgroundColor: '#05080d',
    });
  });
});
