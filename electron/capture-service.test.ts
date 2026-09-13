import { describe, expect, it, vi } from 'vitest';
import type { NativeImage } from 'electron';
import { CaptureService, CaptureServiceError } from './capture-service.js';

function image(size: { width: number; height: number }, png = Buffer.from('source')) {
  return {
    isEmpty: () => false,
    getSize: () => size,
    toPNG: () => png,
    crop: vi.fn(() => ({ toPNG: () => Buffer.from('cropped') })),
  } as unknown as NativeImage;
}

describe('CaptureService', () => {
  it('requests and requires an explicit full-resolution physical thumbnail', async () => {
    const source = image({ width: 2000, height: 1000 });
    const cropped = image({ width: 2000, height: 1000 });
    const getSources = vi.fn(async () => [{ display_id: '42', thumbnail: source }]);
    const service = new CaptureService({
      getCursorScreenPoint: () => ({ x: 1, y: 1 }),
      getDisplayNearestPoint: () => ({
        id: 42,
        bounds: { x: 0, y: 0, width: 1000, height: 500 },
        scaleFactor: 2,
      }),
      physicalDisplaySize: () => ({ width: 2000, height: 1000 }),
      getSources,
      createImage: () => cropped,
    });
    const capture = await service.captureCursorDisplay();
    expect(getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 2000, height: 1000 },
    });
    expect(service.crop(capture, { x: 100, y: 50, width: 300, height: 200 })).toEqual(Buffer.from('cropped'));
    expect(cropped.crop).toHaveBeenCalledWith({ x: 200, y: 100, width: 600, height: 400 });
  });

  it('rejects an undersampled or aspect-mismatched source instead of upscaling it', async () => {
    const service = new CaptureService({
      getCursorScreenPoint: () => ({ x: 1, y: 1 }),
      getDisplayNearestPoint: () => ({
        id: 42,
        bounds: { x: 0, y: 0, width: 1000, height: 500 },
        scaleFactor: 2,
      }),
      physicalDisplaySize: () => ({ width: 2000, height: 1000 }),
      getSources: async () => [{ display_id: '42', thumbnail: image({ width: 1800, height: 900 }) }],
      createImage: () => image({ width: 1, height: 1 }),
    });
    await expect(service.captureCursorDisplay()).rejects.toMatchObject({
      kind: 'sources-unavailable',
      message: expect.stringContaining('full display resolution'),
    } satisfies Partial<CaptureServiceError>);
  });

  it('normalizes source and crop implementation failures', async () => {
    const rejectedSources = new CaptureService({
      getCursorScreenPoint: () => ({ x: 1, y: 1 }),
      getDisplayNearestPoint: () => ({
        id: 42,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        scaleFactor: 1,
      }),
      physicalDisplaySize: () => ({ width: 100, height: 100 }),
      getSources: async () => Promise.reject(new Error('denied')),
      createImage: () => image({ width: 1, height: 1 }),
    });
    await expect(rejectedSources.captureCursorDisplay()).rejects.toMatchObject({
      kind: 'sources-unavailable',
    } satisfies Partial<CaptureServiceError>);

    const cropFailure = new CaptureService({
      getCursorScreenPoint: () => ({ x: 1, y: 1 }),
      getDisplayNearestPoint: () => ({
        id: 42,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        scaleFactor: 1,
      }),
      physicalDisplaySize: () => ({ width: 100, height: 100 }),
      getSources: async () => [{ display_id: '42', thumbnail: image({ width: 100, height: 100 }) }],
      createImage: () => {
        throw new Error('decode failed');
      },
    });
    const capture = await cropFailure.captureCursorDisplay();
    expect(() => cropFailure.crop(capture, { x: 0, y: 0, width: 10, height: 10 })).toThrow(
      CaptureServiceError,
    );
  });

  it('does not fall back to a mismatched display source', async () => {
    const service = new CaptureService({
      getCursorScreenPoint: () => ({ x: 1, y: 1 }),
      getDisplayNearestPoint: () => ({
        id: 42,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        scaleFactor: 1,
      }),
      physicalDisplaySize: () => ({ width: 100, height: 100 }),
      getSources: async () => [{ display_id: 'other', thumbnail: image({ width: 100, height: 100 }) }],
      createImage: () => image({ width: 1, height: 1 }),
    });
    await expect(service.captureCursorDisplay()).rejects.toMatchObject({
      kind: 'sources-unavailable',
    } satisfies Partial<CaptureServiceError>);
  });
});
