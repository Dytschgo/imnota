import { describe, expect, test, vi } from 'vitest';
import Konva from 'konva';
import {
  ANNOTATED_IMAGE_RENDER_LIMITS,
  AnnotatedImageRenderLimitError,
  assertAnnotatedImageRenderBounds,
  renderAnnotatedImageWithDimensions,
} from './export-image';

describe('annotated image render limits', () => {
  test('keeps export and translucent-shape buffers at native scale on a high-DPI display', async () => {
    const ratio = Konva.pixelRatio;
    Konva.pixelRatio = 2;
    const sizes: Array<[number, number]> = [];
    const bitmap = { src: '', naturalWidth: 500, naturalHeight: 300, decode: async () => undefined };
    vi.stubGlobal(
      'Image',
      class {
        constructor() {
          return bitmap;
        }
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return new Proxy(
        { canvas: this },
        {
          get(target, property) {
            if (property === 'canvas') return target.canvas;
            if (property === 'measureText') return () => ({ width: 10 });
            if (property === 'getLineDash') return () => [];
            if (property === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
            return () => {
              sizes.push([target.canvas.width, target.canvas.height]);
            };
          },
        },
      ) as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
      sizes.push([this.width, this.height]);
      return 'data:image/png;base64,rendered';
    });
    try {
      const rendered = await renderAnnotatedImageWithDimensions(
        { filename: 'source.png', dataUrl: 'source', width: 500, height: 300 },
        [
          {
            id: 'alpha',
            kind: 'rectangle',
            x: 10,
            y: 10,
            width: 40,
            height: 40,
            fill: '#ff0000',
            stroke: '#ffffff',
            strokeWidth: 2,
            opacity: 0.5,
            zIndex: 0,
          },
        ],
      );
      expect(rendered.dataUrl).toBe('data:image/png;base64,rendered');
      expect(sizes.some(([width, height]) => width === rendered.width && height === rendered.height)).toBe(
        true,
      );
      expect(sizes.every(([width, height]) => width <= rendered.width && height <= rendered.height)).toBe(
        true,
      );
      expect(bitmap.src).toBe('');
    } finally {
      Konva.pixelRatio = ratio;
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  test('releases the source when decoding fails without masking the original error', async () => {
    const failure = new Error('decode failed');
    const bitmap = { src: '', decode: vi.fn().mockRejectedValue(failure) };
    vi.stubGlobal(
      'Image',
      class {
        constructor() {
          return bitmap;
        }
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      await expect(
        renderAnnotatedImageWithDimensions(
          { filename: 'source.png', dataUrl: 'private image bytes', width: 100, height: 100 },
          [],
        ),
      ).rejects.toBe(failure);
      expect(bitmap.src).toBe('');
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  test('accepts ordinary screenshot output bounds', () => {
    expect(() =>
      assertAnnotatedImageRenderBounds({ x: -32, y: -32, width: 3904, height: 2224 }),
    ).not.toThrow();
  });

  test('rejects an oversized side before stage allocation with actionable dimensions', () => {
    expect(() =>
      assertAnnotatedImageRenderBounds({
        x: 0,
        y: 0,
        width: ANNOTATED_IMAGE_RENDER_LIMITS.maxDimension + 1,
        height: 100,
      }),
    ).toThrowError(AnnotatedImageRenderLimitError);
    expect(() =>
      assertAnnotatedImageRenderBounds({
        x: 0,
        y: 0,
        width: ANNOTATED_IMAGE_RENDER_LIMITS.maxDimension + 1,
        height: 100,
      }),
    ).toThrow(/Move distant annotations closer/);
  });

  test('rejects non-finite geometry', () => {
    expect(() => assertAnnotatedImageRenderBounds({ x: Number.NaN, y: 0, width: 100, height: 100 })).toThrow(
      /invalid or non-finite geometry/,
    );
  });

  test('rejects an extreme font before decoding an image or allocating a stage', async () => {
    await expect(
      renderAnnotatedImageWithDimensions(
        { filename: 'safe.png', dataUrl: 'not-decoded', width: 100, height: 100 },
        [
          {
            id: 'huge-text',
            kind: 'text',
            x: 0,
            y: 0,
            text: 'Too large',
            fontSize: ANNOTATED_IMAGE_RENDER_LIMITS.maxFontSize + 1,
            zIndex: 0,
          },
        ],
      ),
    ).rejects.toThrow(/Reduce that font size before rendering/);
  });
});
