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
        annotations: [{ kind: 'blur' }, { kind: 'rectangle' }],
        pngDataUrl: 'data:image/png;base64,QUJD',
        screenshotId: 'secret',
        recognizer,
      }),
    ).resolves.toBeUndefined();
    await expect(
      recognisedScreenshotText({
        includeRecognisedText: true,
        annotations: [{ kind: 'pixelate' }],
        pngDataUrl: 'data:image/png;base64,QUJD',
        screenshotId: 'secret',
        recognizer,
      }),
    ).resolves.toBeUndefined();
    expect(recognizer.recognize).not.toHaveBeenCalled();
    expect(screenshotHasRedaction([{ kind: 'crop' }, { kind: 'rectangle' }])).toBe(false);
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
