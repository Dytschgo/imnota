import type { CaptureDisplay, CaptureRectangle } from '../src/shared/capture.js';
import { captureRectangleToImagePixels } from '../src/shared/capture.js';
import type { CapturedDisplayImage } from './capture-service.js';

interface DecodedCrop {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
}

export interface CaptureCapabilityEvidence {
  displayId: number;
  bounds: CaptureRectangle;
  scaleFactor: number;
  sourcePixels: { width: number; height: number };
  cropDip: CaptureRectangle;
  cropPixels: { width: number; height: number };
}

export async function probeCaptureDisplays(
  displays: readonly CaptureDisplay[],
  operations: {
    capture(display: CaptureDisplay): Promise<CapturedDisplayImage | null>;
    crop(source: CapturedDisplayImage, selection: CaptureRectangle): Buffer;
    decodeCrop(png: Buffer): DecodedCrop;
  },
): Promise<{ displays: CaptureCapabilityEvidence[] }> {
  if (!displays.length) throw new Error('The operating system did not report a display for capture.');
  const evidence: CaptureCapabilityEvidence[] = [];
  for (const display of displays) {
    if (display.bounds.width < 2 || display.bounds.height < 2)
      throw new Error(`Display ${display.id} is too small for the in-memory capture probe.`);
    const selection: CaptureRectangle = {
      x: 1,
      y: 1,
      width: Math.min(240, display.bounds.width - 1),
      height: Math.min(160, display.bounds.height - 1),
    };
    const source = await operations.capture(display);
    if (!source)
      throw new Error(`Display ${display.id} changed while the in-memory capture probe was running.`);
    if (source.display.id !== display.id)
      throw new Error(
        `The in-memory capture probe received source ${source.display.id} for display ${display.id}.`,
      );
    const expectedCrop = captureRectangleToImagePixels(selection, display.bounds, source.imageSize);
    if (!expectedCrop) throw new Error(`Display ${display.id} did not produce a valid in-memory crop.`);
    const cropImage = operations.decodeCrop(operations.crop(source, selection));
    const cropPixels = cropImage.getSize();
    if (
      cropImage.isEmpty() ||
      cropPixels.width !== expectedCrop.width ||
      cropPixels.height !== expectedCrop.height
    )
      throw new Error(`Display ${display.id} returned unexpected in-memory crop dimensions.`);
    evidence.push({
      displayId: display.id,
      bounds: { ...display.bounds },
      scaleFactor: display.scaleFactor,
      sourcePixels: { ...source.imageSize },
      cropDip: selection,
      cropPixels,
    });
  }
  return { displays: evidence };
}
