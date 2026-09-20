import { describe, expect, it, vi } from 'vitest';
import {
  recognisedScreenshotText,
  screenshotHasRedaction,
  visibleTextMarkdownLines,
  VISIBLE_TEXT_HEADING,
} from '../screenshot-ocr.js';

describe('recognised screenshot text', () => {
  it('returns trimmed recognizer text when the export option is on', async () => {
    const recognizer = {
      recognize: vi.fn(async () => '  Submit order  \n'),
    };
    await expect(
      recognisedScreenshotText({
        includeRecognisedText: true,
        pngDataUrl: 'data:image/png;base64,QUJD',
        screenshotId: 'shot-1',
        recognizer,
      }),
    ).resolves.toBe('Submit order');
    expect(recognizer.recognize).toHaveBeenCalledWith({
      pngDataUrl: 'data:image/png;base64,QUJD',
      screenshotId: 'shot-1',
    });
  });

  it('omits Visible text when a blur or pixelate mark exists and does not call the recognizer', async () => {
    const recognizer = { recognize: vi.fn(async () => 'secret token') };
    await expect(
      recognisedScreenshotText({
        includeRecognisedText: true,
        annotations: [
          { id: 'blur', kind: 'blur', x: 0, y: 0, zIndex: 0 },
          { id: 'box', kind: 'rectangle', x: 0, y: 0, zIndex: 1 },
        ],
        pngDataUrl: 'data:image/png;base64,QUJD',
        screenshotId: 'secret',
        recognizer,
      }),
    ).resolves.toBeUndefined();
    await expect(
      recognisedScreenshotText({
        includeRecognisedText: true,
        annotations: [{ id: 'pixels', kind: 'pixelate', x: 0, y: 0, zIndex: 0 }],
        pngDataUrl: 'data:image/png;base64,QUJD',
        screenshotId: 'secret',
        recognizer,
      }),
    ).resolves.toBeUndefined();
    expect(recognizer.recognize).not.toHaveBeenCalled();
    expect(screenshotHasRedaction([{ kind: 'crop' }, { kind: 'rectangle' }])).toBe(false);
  });

  it('passes the last crop so OCR can read exported pixels instead of cropped-out source', async () => {
    const recognizer = { recognize: vi.fn(async () => 'Checkout') };
    await expect(
      recognisedScreenshotText({
        includeRecognisedText: true,
        annotations: [
          { id: 'first', kind: 'crop', x: 0, y: 0, width: 80, height: 80, zIndex: 0 },
          { id: 'kept', kind: 'crop', x: 10, y: 20, width: 40, height: 30, zIndex: 1 },
        ],
        pngDataUrl: 'data:image/png;base64,QUJD',
        screenshotId: 'shot-1',
        nativeWidth: 100,
        nativeHeight: 80,
        recognizer,
      }),
    ).resolves.toBe('Checkout');
    expect(recognizer.recognize).toHaveBeenCalledWith({
      pngDataUrl: 'data:image/png;base64,QUJD',
      screenshotId: 'shot-1',
      crop: { x: 10, y: 20, width: 40, height: 30 },
    });
  });

  it('does not fail when the recognizer throws or the export option is off', async () => {
    const recognizer = {
      recognize: vi.fn(async () => {
        throw new Error('engine unavailable');
      }),
    };
    await expect(
      recognisedScreenshotText({
        includeRecognisedText: true,
        pngDataUrl: 'data:image/png;base64,QUJD',
        screenshotId: 'shot-1',
        recognizer,
      }),
    ).resolves.toBeUndefined();
    await expect(
      recognisedScreenshotText({
        includeRecognisedText: false,
        pngDataUrl: 'data:image/png;base64,QUJD',
        screenshotId: 'shot-1',
        recognizer,
      }),
    ).resolves.toBeUndefined();
    expect(recognizer.recognize).toHaveBeenCalledOnce();
    expect(visibleTextMarkdownLines('Checkout')).toEqual([VISIBLE_TEXT_HEADING, '', 'Checkout', '']);
    expect(visibleTextMarkdownLines('   ')).toEqual([]);
  });
});
