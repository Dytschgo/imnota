import { afterEach, describe, expect, it, vi } from 'vitest';
import { pixelatedRegion } from './pixelate';

afterEach(() => vi.restoreAllMocks());

describe('pixelation sampling', () => {
  it.each([
    [-80, -30],
    [-80, 30],
    [80, -30],
    [80, 30],
  ])('samples the displayed region for signed drag %s, %s', (width, height) => {
    const sample = { drawImage: vi.fn() };
    const output = { drawImage: vi.fn(), imageSmoothingEnabled: true };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValueOnce(sample as unknown as CanvasRenderingContext2D)
      .mockReturnValueOnce(output as unknown as CanvasRenderingContext2D);
    const image = { naturalWidth: 200, naturalHeight: 200 } as HTMLImageElement;
    const result = pixelatedRegion(image, {
      id: 'draft',
      kind: 'pixelate',
      x: 100,
      y: 100,
      width,
      height,
      zIndex: 0,
    });
    expect(sample.drawImage).toHaveBeenCalledWith(
      image,
      width < 0 ? 20 : 100,
      height < 0 ? 70 : 100,
      80,
      30,
      0,
      0,
      6,
      3,
    );
    expect(result.width).toBe(80);
    expect(result.height).toBe(30);
    expect(output.imageSmoothingEnabled).toBe(false);
  });
});
