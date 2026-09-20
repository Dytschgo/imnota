import { describe, expect, it, vi } from 'vitest';
import type { NativeImage } from 'electron';
import { captureCompositePlan, CaptureService, CaptureServiceError } from './capture-service.js';

function image(size: { width: number; height: number }, png = Buffer.from('source')) {
  return {
    isEmpty: () => false,
    getSize: () => size,
    toPNG: () => png,
    crop: vi.fn(() => ({ toPNG: () => Buffer.from('cropped') })),
  } as unknown as NativeImage;
}

describe('CaptureService', () => {
  it('captures two 3440x1440 displays without overlapping native source sets', async () => {
    const displays = [
      { id: 1, bounds: { x: 0, y: 0, width: 3440, height: 1440 }, scaleFactor: 1 },
      { id: 2, bounds: { x: -3440, y: 0, width: 3440, height: 1440 }, scaleFactor: 1 },
    ];
    let activeRequests = 0;
    let peakRequests = 0;
    const getSources = vi.fn(async (options: { thumbnailSize: { width: number; height: number } }) => {
      activeRequests += 1;
      peakRequests = Math.max(peakRequests, activeRequests);
      await Promise.resolve();
      activeRequests -= 1;
      return displays.map((display) => ({
        display_id: String(display.id),
        thumbnail: image(options.thumbnailSize),
      }));
    });
    const service = new CaptureService({
      physicalDisplaySize: (display) => ({
        width: display.bounds.width,
        height: display.bounds.height,
      }),
      getSources,
      createImage: () => image({ width: 1, height: 1 }),
      createBitmapImage: () => image({ width: 1, height: 1 }),
    });

    await expect(service.captureDisplays(displays)).resolves.toHaveLength(2);
    expect(getSources).toHaveBeenCalledTimes(2);
    expect(peakRequests).toBe(1);
  });

  it('rejects excessive retained display pixels before requesting native sources', async () => {
    const getSources = vi.fn(async () => []);
    const service = new CaptureService({
      physicalDisplaySize: () => ({ width: 5000, height: 5000 }),
      getSources,
      createImage: () => image({ width: 1, height: 1 }),
      createBitmapImage: () => image({ width: 1, height: 1 }),
    });
    const displays = [1, 2, 3].map((id) => ({
      id,
      bounds: { x: 0, y: 0, width: 5000, height: 5000 },
      scaleFactor: 1,
    }));

    await expect(service.captureDisplays(displays)).rejects.toMatchObject({
      kind: 'sources-unavailable',
      message: expect.stringContaining('retained capture memory'),
    } satisfies Partial<CaptureServiceError>);
    expect(getSources).not.toHaveBeenCalled();
  });

  it('rejects an excessive all-screen thumbnail batch before requesting native sources', async () => {
    const getSources = vi.fn(async () => []);
    const service = new CaptureService({
      physicalDisplaySize: (display) =>
        display.id === 1 ? { width: 8000, height: 4000 } : { width: 1000, height: 1000 },
      getSources,
      createImage: () => image({ width: 1, height: 1 }),
      createBitmapImage: () => image({ width: 1, height: 1 }),
    });
    const displays = [1, 2, 3, 4].map((id) => ({
      id,
      bounds: { x: 0, y: 0, width: 1000, height: 1000 },
      scaleFactor: 1,
    }));

    await expect(service.captureDisplays(displays)).rejects.toMatchObject({
      kind: 'sources-unavailable',
      message: expect.stringContaining('native thumbnail memory'),
    } satisfies Partial<CaptureServiceError>);
    expect(getSources).not.toHaveBeenCalled();
  });

  it('requests and requires an explicit full-resolution physical thumbnail', async () => {
    const source = image({ width: 2000, height: 1000 });
    const cropped = image({ width: 2000, height: 1000 });
    const getSources = vi.fn(async () => [{ display_id: '42', thumbnail: source }]);
    const service = new CaptureService({
      physicalDisplaySize: () => ({ width: 2000, height: 1000 }),
      getSources,
      createImage: () => cropped,
      createBitmapImage: () => image({ width: 1, height: 1 }),
    });
    const capture = await service.captureDisplay({
      id: 42,
      bounds: { x: 0, y: 0, width: 1000, height: 500 },
      scaleFactor: 2,
    });
    expect(getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 2000, height: 1000 },
    });
    expect(service.crop(capture, { x: 100, y: 50, width: 300, height: 200 })).toEqual(Buffer.from('cropped'));
    expect(cropped.crop).toHaveBeenCalledWith({ x: 200, y: 100, width: 600, height: 400 });
  });

  it('rejects an undersampled or aspect-mismatched source instead of upscaling it', async () => {
    const service = new CaptureService({
      physicalDisplaySize: () => ({ width: 2000, height: 1000 }),
      getSources: async () => [{ display_id: '42', thumbnail: image({ width: 1800, height: 900 }) }],
      createImage: () => image({ width: 1, height: 1 }),
      createBitmapImage: () => image({ width: 1, height: 1 }),
    });
    await expect(
      service.captureDisplay({
        id: 42,
        bounds: { x: 0, y: 0, width: 1000, height: 500 },
        scaleFactor: 2,
      }),
    ).rejects.toMatchObject({
      kind: 'sources-unavailable',
      message: expect.stringContaining('full display resolution'),
    } satisfies Partial<CaptureServiceError>);
  });

  it('normalizes source and crop implementation failures', async () => {
    const rejectedSources = new CaptureService({
      physicalDisplaySize: () => ({ width: 100, height: 100 }),
      getSources: async () => Promise.reject(new Error('denied')),
      createImage: () => image({ width: 1, height: 1 }),
      createBitmapImage: () => image({ width: 1, height: 1 }),
    });
    await expect(
      rejectedSources.captureDisplay({
        id: 42,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        scaleFactor: 1,
      }),
    ).rejects.toMatchObject({
      kind: 'sources-unavailable',
    } satisfies Partial<CaptureServiceError>);

    const cropFailure = new CaptureService({
      physicalDisplaySize: () => ({ width: 100, height: 100 }),
      getSources: async () => [{ display_id: '42', thumbnail: image({ width: 100, height: 100 }) }],
      createImage: () => {
        throw new Error('decode failed');
      },
      createBitmapImage: () => image({ width: 1, height: 1 }),
    });
    const capture = await cropFailure.captureDisplay({
      id: 42,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      scaleFactor: 1,
    });
    expect(() => cropFailure.crop(capture, { x: 0, y: 0, width: 10, height: 10 })).toThrow(
      CaptureServiceError,
    );
  });

  it('crops the selected 150% display and never a primary source', async () => {
    const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };
    const secondary = {
      id: 2,
      bounds: { x: 1920, y: 0, width: 1280, height: 720 },
      scaleFactor: 1.5,
    };
    const cropped = image({ width: 1920, height: 1080 });
    const getSources = vi.fn(async (options: { thumbnailSize: { width: number; height: number } }) => [
      { display_id: String(primary.id), thumbnail: image({ width: 1920, height: 1080 }) },
      { display_id: String(secondary.id), thumbnail: image(options.thumbnailSize) },
    ]);
    const service = new CaptureService({
      physicalDisplaySize: (display) => ({
        width: Math.round(display.bounds.width * display.scaleFactor),
        height: Math.round(display.bounds.height * display.scaleFactor),
      }),
      getSources,
      createImage: () => cropped,
      createBitmapImage: () => image({ width: 1, height: 1 }),
    });

    const capture = await service.captureDisplay(secondary);
    expect(getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });
    expect(service.crop(capture, { x: 100, y: 50, width: 200, height: 100 })).toEqual(Buffer.from('cropped'));
    expect(cropped.crop).toHaveBeenCalledWith({ x: 150, y: 75, width: 300, height: 150 });
    expect(capture.display.id).toBe(2);
  });

  it('does not fall back to a mismatched display source', async () => {
    const service = new CaptureService({
      physicalDisplaySize: () => ({ width: 100, height: 100 }),
      getSources: async () => [{ display_id: 'other', thumbnail: image({ width: 100, height: 100 }) }],
      createImage: () => image({ width: 1, height: 1 }),
      createBitmapImage: () => image({ width: 1, height: 1 }),
    });
    await expect(
      service.captureDisplay({
        id: 42,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        scaleFactor: 1,
      }),
    ).rejects.toMatchObject({
      kind: 'sources-unavailable',
    } satisfies Partial<CaptureServiceError>);
  });

  it('plans a left-hand 150% selection from that display only', () => {
    const left = {
      display: {
        id: 2,
        bounds: { x: -1280, y: 0, width: 1280, height: 720 },
        scaleFactor: 1.5,
      },
      imageSize: { width: 1920, height: 1080 },
      png: Buffer.from('left'),
    };
    expect(captureCompositePlan([left], { x: -1180, y: 40, width: 200, height: 100 })).toEqual({
      width: 300,
      height: 150,
      parts: [
        {
          capture: left,
          source: { x: 150, y: 60, width: 300, height: 150 },
          destination: { x: 0, y: 0, width: 300, height: 150 },
        },
      ],
    });
  });

  it('plans a negative-coordinate mixed-DPI selection on one densest output grid', () => {
    const left = {
      display: {
        id: 1,
        bounds: { x: -1000, y: -100, width: 1000, height: 500 },
        scaleFactor: 1,
      },
      imageSize: { width: 1000, height: 500 },
      png: Buffer.from('left'),
    };
    const right = {
      display: {
        id: 2,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        scaleFactor: 2,
      },
      imageSize: { width: 1600, height: 1200 },
      png: Buffer.from('right'),
    };
    expect(captureCompositePlan([left, right], { x: -200, y: -50, width: 400, height: 200 })).toEqual({
      width: 800,
      height: 400,
      parts: [
        {
          capture: left,
          source: { x: 800, y: 50, width: 200, height: 200 },
          destination: { x: 0, y: 0, width: 400, height: 400 },
        },
        {
          capture: right,
          source: { x: 0, y: 0, width: 400, height: 300 },
          destination: { x: 400, y: 100, width: 400, height: 300 },
        },
      ],
    });
  });

  it('composes exact source crops while leaving uncovered desktop gaps transparent', () => {
    const sourceBitmaps = new Map<string, Buffer>([
      ['left', Buffer.alloc(2 * 2 * 4, 1)],
      ['right', Buffer.alloc(2 * 2 * 4, 2)],
    ]);
    let composedBitmap = Buffer.alloc(0);
    const service = new CaptureService({
      physicalDisplaySize: () => ({ width: 2, height: 2 }),
      getSources: async () => [],
      createImage: (png) => {
        const key = png.toString();
        const cropped = {
          resize: vi.fn(() => cropped),
          toBitmap: () => sourceBitmaps.get(key)!,
        };
        return {
          crop: vi.fn(() => cropped),
        } as unknown as NativeImage;
      },
      createBitmapImage: (bitmap, size) => {
        composedBitmap = Buffer.from(bitmap);
        return image(size, Buffer.from('composed'));
      },
    });
    const displays = [
      {
        display: { id: 1, bounds: { x: -2, y: 0, width: 2, height: 2 }, scaleFactor: 1 },
        imageSize: { width: 2, height: 2 },
        png: Buffer.from('left'),
      },
      {
        display: { id: 2, bounds: { x: 1, y: 0, width: 2, height: 2 }, scaleFactor: 1 },
        imageSize: { width: 2, height: 2 },
        png: Buffer.from('right'),
      },
    ];
    expect(service.compose(displays, { x: -2, y: 0, width: 5, height: 2 })).toEqual(Buffer.from('composed'));
    expect([...composedBitmap.subarray(2 * 4, 3 * 4)]).toEqual([0, 0, 0, 0]);
    expect(composedBitmap[0]).toBe(1);
    expect(composedBitmap[3 * 4]).toBe(2);
  });

  it('rejects a huge union before allocating an oversized output bitmap', () => {
    expect(
      captureCompositePlan(
        [
          {
            display: {
              id: 1,
              bounds: { x: 0, y: 0, width: 12_000, height: 6_000 },
              scaleFactor: 1,
            },
            imageSize: { width: 12_000, height: 6_000 },
            png: Buffer.from('large'),
          },
        ],
        { x: 0, y: 0, width: 12_000, height: 6_000 },
      ),
    ).toBeNull();
  });
});
