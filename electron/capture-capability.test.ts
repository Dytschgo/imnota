// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { CaptureDisplay, CaptureRectangle } from '../src/shared/capture.js';
import type { CapturedDisplayImage } from './capture-service.js';
import { probeCaptureDisplays } from './capture-capability.js';

const displays: CaptureDisplay[] = [
  { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 500 }, scaleFactor: 2 },
  { id: 2, bounds: { x: -800, y: -100, width: 800, height: 600 }, scaleFactor: 1.25 },
];

function source(display: CaptureDisplay, id = display.id): CapturedDisplayImage {
  return {
    display: { ...display, id, bounds: { ...display.bounds } },
    png: Buffer.from(String(id)),
    imageSize: {
      width: Math.round(display.bounds.width * display.scaleFactor),
      height: Math.round(display.bounds.height * display.scaleFactor),
    },
  };
}

describe('real display capture capability evidence', () => {
  it('captures every enumerated display by id and records expected in-memory crop geometry', async () => {
    const capture = vi.fn(async (display: CaptureDisplay) => source(display));
    const crop = vi.fn((captured: CapturedDisplayImage, selection: CaptureRectangle) => {
      const scaleX = captured.imageSize.width / captured.display.bounds.width;
      const scaleY = captured.imageSize.height / captured.display.bounds.height;
      return Buffer.from(
        JSON.stringify({
          width: Math.ceil((selection.x + selection.width) * scaleX) - Math.floor(selection.x * scaleX),
          height: Math.ceil((selection.y + selection.height) * scaleY) - Math.floor(selection.y * scaleY),
        }),
      );
    });
    const report = await probeCaptureDisplays(displays, {
      capture,
      crop,
      decodeCrop: (png) => {
        const size = JSON.parse(png.toString()) as { width: number; height: number };
        return {
          isEmpty: () => false,
          getSize: () => size,
        };
      },
    });

    expect(capture.mock.calls.map(([display]) => display.id)).toEqual([1, 2]);
    expect(
      report.displays.map(({ displayId, bounds, scaleFactor }) => ({ displayId, bounds, scaleFactor })),
    ).toEqual(displays.map(({ id: displayId, bounds, scaleFactor }) => ({ displayId, bounds, scaleFactor })));
    expect(report.displays[0]?.cropPixels).toEqual({ width: 480, height: 320 });
    expect(report.displays[1]?.cropPixels).toEqual({ width: 301, height: 201 });
  });

  it('fails closed when capture reports another source id or a display changes', async () => {
    await expect(
      probeCaptureDisplays([displays[0]!], {
        capture: async (display) => source(display, 2),
        crop: vi.fn(),
        decodeCrop: vi.fn(),
      }),
    ).rejects.toThrow(/source 2 for display 1/);
    await expect(
      probeCaptureDisplays([displays[0]!], {
        capture: async () => null,
        crop: vi.fn(),
        decodeCrop: vi.fn(),
      }),
    ).rejects.toThrow(/changed/);
  });
});
