import { describe, expect, it } from 'vitest';
import { captureRectangleToImagePixels, isCaptureDelaySeconds, normalizeCaptureRectangle } from '../capture';

describe('capture rectangle mapping', () => {
  it('does not include an extra pixel when mapping exact one-to-one coordinates', () => {
    const selection = { x: 241, y: 1, width: 240, height: 160 };
    expect(
      captureRectangleToImagePixels(selection, { width: 1920, height: 1080 }, { width: 1920, height: 1080 }),
    ).toEqual(selection);
  });

  it('maps DIP selection through the returned thumbnail rather than an assumed scale factor', () => {
    expect(
      captureRectangleToImagePixels(
        { x: 100, y: 50, width: 300, height: 200 },
        { width: 1000, height: 500 },
        { width: 1800, height: 900 },
      ),
    ).toEqual({ x: 180, y: 90, width: 540, height: 360 });
  });

  it('maps a 150% DIP selection through the selected display thumbnail', () => {
    expect(
      captureRectangleToImagePixels(
        { x: 80, y: 40, width: 200, height: 100 },
        { width: 1280, height: 720 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ x: 120, y: 60, width: 300, height: 150 });
  });

  it('clamps a partly outside selection and rejects an empty one', () => {
    expect(
      normalizeCaptureRectangle({ x: -10, y: 10, width: 30, height: 10 }, { width: 100, height: 50 }),
    ).toEqual({
      x: 0,
      y: 10,
      width: 20,
      height: 10,
    });
    expect(
      captureRectangleToImagePixels(
        { x: 10, y: 10, width: 0, height: 2 },
        { width: 100, height: 50 },
        { width: 200, height: 100 },
      ),
    ).toBeNull();
  });

  it('accepts only the 3s and 5s capture delays', () => {
    expect(isCaptureDelaySeconds(3)).toBe(true);
    expect(isCaptureDelaySeconds(5)).toBe(true);
    expect(isCaptureDelaySeconds(0)).toBe(false);
    expect(isCaptureDelaySeconds(4)).toBe(false);
    expect(isCaptureDelaySeconds(undefined)).toBe(false);
  });
});
