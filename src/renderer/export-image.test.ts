import { describe, expect, test } from 'vitest';
import {
  ANNOTATED_IMAGE_RENDER_LIMITS,
  AnnotatedImageRenderLimitError,
  assertAnnotatedImageRenderBounds,
  renderAnnotatedImageWithDimensions,
} from './export-image';

describe('annotated image render limits', () => {
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
